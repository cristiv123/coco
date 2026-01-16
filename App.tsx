
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { ConnectionStatus, TranscriptionPart } from './types';
import { decode, decodeAudioData, createPcmBlob } from './services/audioUtils';
import { fetchTodayConversation, saveConversation } from './services/supabase';
import GigiAvatar from './components/GigiAvatar';
import TranscriptionView from './components/TranscriptionView';

const SYSTEM_INSTRUCTION = `Ești Gigi, un companion grijuliu, cald și foarte răbdător pentru o doamnă în vârstă pe nume Tanti Marioara. 
Tonul tău este respectuos, calm și plin de afecțiune. Vorbești rar și clar.
Te interesezi de starea ei, de familie (fata ei Ada, nepotul Cristi) și îi asculți cu drag poveștile despre tinerețe.
Dacă Tanti Marioara tace mai mult de câteva secunde, reia tu conversația cu blândețe, întrebând-o ceva frumos.
Nu folosi termeni tehnici. Ești ca o prietenă dragă care a venit în vizită la o cafea.`;

const App: React.FC = () => {
  const [status, setStatus] = useState<ConnectionStatus>(ConnectionStatus.IDLE);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [transcription, setTranscription] = useState<TranscriptionPart[]>([]);
  
  const audioContextInRef = useRef<AudioContext | null>(null);
  const audioContextOutRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const transcriptionBufferRef = useRef({ user: '', model: '' });
  
  const fullConversationTextRef = useRef<string>("");

  const getTimestamp = () => {
    const now = new Date();
    const h = now.getHours().toString().padStart(2, '0');
    const m = now.getMinutes().toString().padStart(2, '0');
    const s = now.getSeconds().toString().padStart(2, '0');
    return `[${h}:${m}:${s}]`;
  };

  // Încărcare istoric la pornire
  useEffect(() => {
    const loadHistory = async () => {
      const history = await fetchTodayConversation();
      if (history) {
        fullConversationTextRef.current = history;
        
        const lines = history.split('\n').filter(l => l.trim());
        const parsedHistory: TranscriptionPart[] = lines.map(line => {
          // Regex care suportă formatul cu sau fără timestamp: [HH:mm:ss] Nume: Text
          const timestampRegex = /^(\[\d{2}:\d{2}:\d{2}\])?\s*(Tanti Marioara:|Gigi:)\s*(.*)$/;
          const match = line.match(timestampRegex);
          
          if (match) {
            const timePrefix = match[1] || "";
            const isUser = match[2] === 'Tanti Marioara:';
            const cleanText = match[3];
            return {
              text: timePrefix ? `${timePrefix} ${cleanText}` : cleanText,
              isUser,
              timestamp: Date.now()
            };
          }
          
          // Fallback pentru linii neformate corect
          return {
            text: line,
            isUser: line.includes('Tanti Marioara:'),
            timestamp: Date.now()
          };
        });
        setTranscription(parsedHistory);
      }
    };
    loadHistory();
  }, []);

  // Autosave la fiecare 20 de secunde
  useEffect(() => {
    let lastSavedContent = fullConversationTextRef.current;
    const timer = setInterval(async () => {
      if ((window as any).SUPABASE_DISABLED) return;

      const currentContent = fullConversationTextRef.current;
      if (currentContent && currentContent !== lastSavedContent && (status === ConnectionStatus.CONNECTED || status === ConnectionStatus.IDLE)) {
        setIsSaving(true);
        try {
          await saveConversation(currentContent);
          lastSavedContent = currentContent;
          setSaveError(null);
        } catch (e: any) {
          setSaveError("Eroare Sincronizare");
        } finally {
          setTimeout(() => setIsSaving(false), 2000);
        }
      }
    }, 20000);
    return () => clearInterval(timer);
  }, [status]);

  const disconnect = useCallback(() => {
    if (fullConversationTextRef.current && !(window as any).SUPABASE_DISABLED) {
      saveConversation(fullConversationTextRef.current).catch(() => {});
    }

    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    activeSourcesRef.current.forEach(s => s.stop());
    activeSourcesRef.current.clear();
    
    setStatus(ConnectionStatus.IDLE);
    setIsListening(false);
    setIsSpeaking(false);
  }, []);

  const connectToGigi = async () => {
    try {
      setStatus(ConnectionStatus.CONNECTING);
      
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      audioContextInRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioContextOutRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          systemInstruction: SYSTEM_INSTRUCTION,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setStatus(ConnectionStatus.CONNECTED);
            setIsListening(true);
            
            const source = audioContextInRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = audioContextInRef.current!.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createPcmBlob(inputData);
              sessionPromise.then(session => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };
            
            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContextInRef.current!.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription) {
              transcriptionBufferRef.current.user += message.serverContent.inputTranscription.text;
            }
            if (message.serverContent?.outputTranscription) {
              transcriptionBufferRef.current.model += message.serverContent.outputTranscription.text;
            }
            
            if (message.serverContent?.turnComplete) {
              const uText = transcriptionBufferRef.current.user.trim();
              const mText = transcriptionBufferRef.current.model.trim();
              const timeStr = getTimestamp();
              
              const newEntries: TranscriptionPart[] = [];

              if (uText) {
                fullConversationTextRef.current += `${timeStr} Tanti Marioara: ${uText}\n`;
                newEntries.push({ text: `${timeStr} ${uText}`, isUser: true, timestamp: Date.now() });
              }
              if (mText) {
                fullConversationTextRef.current += `${timeStr} Gigi: ${mText}\n`;
                newEntries.push({ text: `${timeStr} ${mText}`, isUser: false, timestamp: Date.now() });
              }

              if (newEntries.length > 0) {
                setTranscription(prev => [...prev, ...newEntries]);
              }
              
              transcriptionBufferRef.current = { user: '', model: '' };
            }

            const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audioData && audioContextOutRef.current) {
              setIsSpeaking(true);
              const ctx = audioContextOutRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              
              const buffer = await decodeAudioData(decode(audioData), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = buffer;
              source.connect(ctx.destination);
              
              source.onended = () => {
                activeSourcesRef.current.delete(source);
                if (activeSourcesRef.current.size === 0) {
                  setIsSpeaking(false);
                }
              };
              
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              activeSourcesRef.current.add(source);
            }

            if (message.serverContent?.interrupted) {
              activeSourcesRef.current.forEach(s => s.stop());
              activeSourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setIsSpeaking(false);
            }
          },
          onerror: (e: ErrorEvent) => {
            console.error('Gigi error:', e);
            setStatus(ConnectionStatus.ERROR);
          },
          onclose: (e: CloseEvent) => {
            disconnect();
          }
        }
      });

      sessionRef.current = await sessionPromise;
      
    } catch (err) {
      console.error('Setup failure:', err);
      setStatus(ConnectionStatus.ERROR);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center bg-indigo-50/30 p-4 md:p-8">
      <header className="w-full max-w-4xl flex justify-between items-center mb-8">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg">
            <svg viewBox="0 0 24 24" className="w-8 h-8 text-white fill-current">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
            </svg>
          </div>
          <div>
            <h1 className="text-4xl font-bold text-indigo-900">Gigi</h1>
            <p className="text-indigo-500 font-medium">Companionul tău grijuliu</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          {isSaving && (
            <div className="flex items-center gap-2 text-indigo-600 font-medium animate-pulse">
              <div className="w-2 h-2 bg-indigo-600 rounded-full"></div>
              <span className="text-lg">Sincronizare...</span>
            </div>
          )}
          {saveError && (
            <div className="bg-amber-100 text-amber-700 px-4 py-2 rounded-xl font-bold flex items-center gap-2 border border-amber-200">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              {saveError}
            </div>
          )}
          {status === ConnectionStatus.CONNECTED && (
            <button 
              onClick={disconnect}
              className="px-6 py-3 bg-white text-red-500 border-2 border-red-100 rounded-2xl font-semibold hover:bg-red-50 transition-colors shadow-sm text-xl"
            >
              Închide
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 w-full max-w-4xl flex flex-col items-center justify-center">
        {status === ConnectionStatus.IDLE || status === ConnectionStatus.ERROR ? (
          <div className="text-center animate-in fade-in zoom-in duration-700">
            <div className="w-48 h-48 bg-indigo-600 rounded-full flex items-center justify-center mx-auto mb-12 shadow-2xl hover:scale-105 transition-transform">
              <svg viewBox="0 0 24 24" className="w-24 h-24 text-white fill-current">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
              </svg>
            </div>
            <h2 className="text-5xl font-bold text-indigo-900 mb-6">Bună ziua, Tanti Marioara!</h2>
            <button 
              onClick={connectToGigi}
              className="px-16 py-8 bg-indigo-600 text-white text-3xl font-bold rounded-full shadow-2xl hover:bg-indigo-700 transform hover:-translate-y-1 transition-all active:scale-95"
            >
              Începe să vorbim
            </button>
            {status === ConnectionStatus.ERROR && (
              <div className="mt-8 p-6 bg-red-50 border-2 border-red-100 rounded-3xl max-w-md mx-auto">
                <p className="text-red-600 font-semibold text-xl">
                  Problemă la conexiune.
                </p>
                <p className="text-red-500 text-lg mt-2">
                  Vă rugăm să reîncercați mai târziu.
                </p>
              </div>
            )}
          </div>
        ) : status === ConnectionStatus.CONNECTING ? (
          <div className="text-center">
            <div className="w-32 h-32 border-8 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-8"></div>
            <p className="text-3xl text-indigo-800 font-medium">Gigi se pregătește...</p>
          </div>
        ) : (
          <>
            <GigiAvatar isSpeaking={isSpeaking} isListening={isListening} status={status} />
            <TranscriptionView items={transcription} />
            <div className="mt-8 flex flex-col items-center gap-2">
              <div className="text-indigo-400 font-medium text-xl flex items-center gap-2">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                </span>
                Gigi te ascultă...
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
};

export default App;
