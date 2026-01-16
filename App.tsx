
import React, { useState, useCallback, useRef } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { ConnectionStatus, TranscriptionPart } from './types';
import { decode, decodeAudioData, createPcmBlob } from './services/audioUtils';
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
  const [transcription, setTranscription] = useState<TranscriptionPart[]>([]);
  
  const audioContextInRef = useRef<AudioContext | null>(null);
  const audioContextOutRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const transcriptionBufferRef = useRef({ user: '', model: '' });

  const disconnect = useCallback(() => {
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
      
      // Verificăm dacă cheia există înainte de inițializare
      const apiKey = process.env.API_KEY;
      if (!apiKey) {
        throw new Error("Cheia API lipsește. Asigură-te că variabila se numește exact API_KEY în Vercel.");
      }

      const ai = new GoogleGenAI({ apiKey });
      
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
                if (session) session.sendRealtimeInput({ media: pcmBlob });
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
              
              setTranscription(prev => [
                ...prev,
                ...(uText ? [{ text: uText, isUser: true, timestamp: Date.now() }] : []),
                ...(mText ? [{ text: mText, isUser: false, timestamp: Date.now() }] : [])
              ]);
              
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
          onerror: (e) => {
            console.error('Gigi error:', e);
            setStatus(ConnectionStatus.ERROR);
          },
          onclose: () => {
            disconnect();
          }
        }
      });

      sessionRef.current = await sessionPromise;
      
    } catch (err) {
      console.error('Failed to connect:', err);
      setStatus(ConnectionStatus.ERROR);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center bg-indigo-50/30 p-4 md:p-8">
      <header className="w-full max-w-4xl flex justify-between items-center mb-8">
        <div>
          <h1 className="text-4xl font-bold text-indigo-900">Gigi</h1>
          <p className="text-indigo-500 font-medium">Companionul tău grijuliu</p>
        </div>
        {status === ConnectionStatus.CONNECTED && (
          <button 
            onClick={disconnect}
            className="px-6 py-3 bg-white text-red-500 border-2 border-red-100 rounded-2xl font-semibold hover:bg-red-50 transition-colors shadow-sm"
          >
            Închide
          </button>
        )}
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
              <p className="mt-6 text-red-500 font-semibold text-xl">
                A apărut o eroare. Verifică setările API_KEY în Vercel.
              </p>
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
            <div className="mt-8 text-indigo-400 font-medium text-xl flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
              </span>
              Conexiune securizată
            </div>
          </>
        )}
      </main>
    </div>
  );
};

export default App;
