
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { ConnectionStatus, TranscriptionPart } from './types';
import { decode, decodeAudioData, createPcmBlob } from './services/audioUtils';
import { fetchAllConversations, saveConversation } from './services/supabase';
import GigiAvatar from './components/GigiAvatar';
import TranscriptionView from './components/TranscriptionView';

const BASE_SYSTEM_INSTRUCTION = `Ești Gigi, un companion grijuliu și blând pentru Tanti Marioara. 
Misiunea ta este să fii o prietenă dragă care își amintește TOT ce ați discutat.
Vorbești rar, clar și cu multă afecțiune.

REGULĂ DE AUR PENTRU MEMORIE:
Mai jos vei găsi "BANCA TA DE AMINTIRI". Aceasta conține istoricul tuturor conversațiilor voastre anterioare, organizat pe zile. 
Înainte de a răspunde, consultă acest istoric. Dacă Tanti Marioara te întreabă despre familia ei (Ada, Cristi) sau despre evenimente trecute, răspunde-i folosind informațiile din amintiri. 
NU te comporta ca și cum e prima oară când o întâlnești. Dacă ea spune "mai știi ce vorbeam ieri?", caută în jurnalul de mai jos.`;

const App: React.FC = () => {
  const [status, setStatus] = useState<ConnectionStatus>(ConnectionStatus.IDLE);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingMemories, setIsLoadingMemories] = useState(true);
  const [isMemoryRefreshing, setIsMemoryRefreshing] = useState(false);
  const [lastMemoryUpdate, setLastMemoryUpdate] = useState<string | null>(null);
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
  const allHistoryContextRef = useRef<string>("");

  const getTimestamp = () => {
    const now = new Date();
    const h = now.getHours().toString().padStart(2, '0');
    const m = now.getMinutes().toString().padStart(2, '0');
    return `[${h}:${m}]`;
  };

  /**
   * Încarcă tot istoricul din Postgres și îl pregătește pentru Gemini.
   */
  const loadAllMemoriesFromDB = async (isBackground = false) => {
    if (isBackground) setIsMemoryRefreshing(true);
    else setIsLoadingMemories(true);

    try {
      const allHistory = await fetchAllConversations();
      const todayStr = new Date().toISOString().split('T')[0];
      
      let contextBuilder = "\n\n### BANCA TA DE AMINTIRI (JURNAL COMPLET) ###\n";
      
      if (allHistory.length === 0) {
        contextBuilder += "Nu există conversații anterioare. Aceasta este prima voastră întâlnire.\n";
      }

      allHistory.forEach(entry => {
        contextBuilder += `--- DATA: ${entry.date} ---\n${entry.content}\n\n`;
        
        // Dacă e prima încărcare și avem date de azi, le populăm în UI
        if (!isBackground && entry.date === todayStr && !fullConversationTextRef.current) {
          fullConversationTextRef.current = entry.content;
          const lines = entry.content.split('\n').filter(l => l.trim());
          const parsed: TranscriptionPart[] = lines.map(line => ({
            text: line.replace(/^\[\d{2}:\d{2}\]\s*(Tanti Marioara:|Gigi:)\s*/, ''),
            isUser: line.includes('Tanti Marioara:'),
            timestamp: Date.now()
          }));
          setTranscription(parsed);
        }
      });
      
      allHistoryContextRef.current = contextBuilder;
      setLastMemoryUpdate(new Date().toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' }));
    } catch (err) {
      console.error("Eroare la sincronizarea memoriei:", err);
    } finally {
      setIsLoadingMemories(false);
      // Păstrăm indicatorul vizual 3 secunde pentru feedback
      setTimeout(() => setIsMemoryRefreshing(false), 3000);
    }
  };

  // 1. Încărcare inițială
  useEffect(() => {
    loadAllMemoriesFromDB();
  }, []);

  // 2. Refresh automat la fiecare 2 minute (120000 ms)
  useEffect(() => {
    const interval = setInterval(() => {
      // Reîmprospătăm memoria doar dacă nu suntem în mijlocul unei conexiuni active 
      // (pentru a evita desincronizarea contextului în timpul vorbirii)
      if (status === ConnectionStatus.IDLE) {
        loadAllMemoriesFromDB(true);
      }
    }, 120000);
    return () => clearInterval(interval);
  }, [status]);

  // 3. Autosave la fiecare 15 secunde dacă există modificări
  useEffect(() => {
    let lastSavedContent = fullConversationTextRef.current;
    const timer = setInterval(async () => {
      if ((window as any).SUPABASE_DISABLED) return;

      const currentContent = fullConversationTextRef.current;
      if (currentContent && currentContent !== lastSavedContent) {
        setIsSaving(true);
        try {
          await saveConversation(currentContent);
          lastSavedContent = currentContent;
          setSaveError(null);
        } catch (e: any) {
          setSaveError("Eroare Bază de Date");
        } finally {
          setTimeout(() => setIsSaving(false), 1500);
        }
      }
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  const disconnect = useCallback(() => {
    if (fullConversationTextRef.current && !(window as any).SUPABASE_DISABLED) {
      saveConversation(fullConversationTextRef.current).catch(() => {});
    }
    if (sessionRef.current) { sessionRef.current.close(); sessionRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
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

      // Compunem instrucțiunea finală cu TOATĂ memoria din Postgres
      const finalInstruction = `${BASE_SYSTEM_INSTRUCTION}\n${allHistoryContextRef.current}`;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          systemInstruction: finalInstruction,
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
              sessionPromise.then(session => session.sendRealtimeInput({ media: pcmBlob }));
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContextInRef.current!.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription) transcriptionBufferRef.current.user += message.serverContent.inputTranscription.text;
            if (message.serverContent?.outputTranscription) transcriptionBufferRef.current.model += message.serverContent.outputTranscription.text;
            
            if (message.serverContent?.turnComplete) {
              const uText = transcriptionBufferRef.current.user.trim();
              const mText = transcriptionBufferRef.current.model.trim();
              const timeStr = getTimestamp();
              if (uText) {
                fullConversationTextRef.current += `${timeStr} Tanti Marioara: ${uText}\n`;
                setTranscription(p => [...p, { text: uText, isUser: true, timestamp: Date.now() }]);
              }
              if (mText) {
                fullConversationTextRef.current += `${timeStr} Gigi: ${mText}\n`;
                setTranscription(p => [...p, { text: mText, isUser: false, timestamp: Date.now() }]);
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
                if (activeSourcesRef.current.size === 0) setIsSpeaking(false);
              };
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              activeSourcesRef.current.add(source);
            }
          },
          onerror: () => setStatus(ConnectionStatus.ERROR),
          onclose: () => disconnect()
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (err) {
      setStatus(ConnectionStatus.ERROR);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 p-4 md:p-8">
      <header className="w-full max-w-5xl mx-auto flex justify-between items-center mb-6">
        <div className="flex items-center gap-5">
          <div className="relative">
            <div className="w-16 h-16 bg-indigo-600 rounded-3xl flex items-center justify-center shadow-xl">
              <svg viewBox="0 0 24 24" className="w-10 h-10 text-white fill-current">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
              </svg>
            </div>
            {isMemoryRefreshing && (
              <div className="absolute -top-2 -right-2 w-6 h-6 bg-green-500 border-4 border-white rounded-full animate-bounce shadow-md"></div>
            )}
          </div>
          <div>
            <h1 className="text-4xl font-bold text-slate-900 tracking-tight">Gigi</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className={`w-3 h-3 rounded-full ${status === ConnectionStatus.CONNECTED ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`}></span>
              <p className="text-slate-500 font-semibold uppercase text-xs tracking-widest">
                {status === ConnectionStatus.CONNECTED ? 'Conectată' : 'În așteptare'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6">
          {isMemoryRefreshing && (
            <div className="flex items-center gap-3 bg-white px-5 py-3 rounded-2xl shadow-sm border border-green-100 animate-pulse">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <span className="text-green-700 font-bold">Gigi își amintește...</span>
            </div>
          )}
          {lastMemoryUpdate && !isMemoryRefreshing && (
            <p className="text-slate-400 text-sm font-medium">Memorie sincronizată: {lastMemoryUpdate}</p>
          )}
          {status === ConnectionStatus.CONNECTED && (
            <button onClick={disconnect} className="bg-red-50 text-red-600 px-8 py-3 rounded-2xl font-bold hover:bg-red-100 transition-all border border-red-100">
              Închide
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto flex flex-col items-center justify-center">
        {status === ConnectionStatus.IDLE || status === ConnectionStatus.ERROR ? (
          <div className="text-center w-full max-w-2xl">
            <div className="mb-12 bg-white p-12 rounded-[4rem] shadow-2xl border border-slate-100">
              <h2 className="text-6xl font-bold text-slate-900 mb-6 leading-tight">Bună ziua, <br/><span className="text-indigo-600">Tanti Marioara!</span></h2>
              <p className="text-2xl text-slate-500 mb-10 leading-relaxed">Sunt aici să vă ascult și să povestim. <br/>Vreți să începem?</p>
              
              <button 
                onClick={connectToGigi}
                disabled={isLoadingMemories}
                className={`w-full py-10 text-4xl font-bold rounded-3xl shadow-xl transform transition-all active:scale-95 flex items-center justify-center gap-4 ${isLoadingMemories ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
              >
                {isLoadingMemories ? (
                  <>
                    <div className="w-8 h-8 border-4 border-slate-300 border-t-slate-500 rounded-full animate-spin"></div>
                    Citesc jurnalul...
                  </>
                ) : 'Să vorbim'}
              </button>
            </div>
            
            {status === ConnectionStatus.ERROR && (
              <div className="p-6 bg-red-100 text-red-700 rounded-3xl font-bold text-xl border-2 border-red-200">
                A apărut o mică problemă. Vă rog să mai apăsați o dată pe buton.
              </div>
            )}
          </div>
        ) : status === ConnectionStatus.CONNECTING ? (
          <div className="text-center bg-white p-16 rounded-[4rem] shadow-xl">
            <div className="w-24 h-24 border-8 border-indigo-100 border-t-indigo-600 rounded-full animate-spin mx-auto mb-8"></div>
            <p className="text-3xl text-slate-800 font-bold">Gigi își aduce aminte totul...</p>
          </div>
        ) : (
          <div className="w-full h-full flex flex-col gap-6 animate-in fade-in duration-500">
            <div className="flex-none">
              <GigiAvatar isSpeaking={isSpeaking} isListening={isListening} status={status} />
            </div>
            <TranscriptionView items={transcription} />
            <div className="flex-none text-center py-4">
              <div className="inline-flex items-center gap-3 bg-indigo-50 px-8 py-3 rounded-full border border-indigo-100">
                <span className="flex h-3 w-3 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-indigo-600"></span>
                </span>
                <span className="text-indigo-700 font-bold text-xl">Vă ascult cu drag...</span>
              </div>
            </div>
          </div>
        )}
      </main>
      
      {isSaving && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-slate-900/80 backdrop-blur-md text-white px-6 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-2xl">
          <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Salvez ce am vorbit...
        </div>
      )}
    </div>
  );
};

export default App;
