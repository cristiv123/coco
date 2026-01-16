
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { ConnectionStatus, TranscriptionPart } from './types';
import { decode, decodeAudioData, createPcmBlob } from './services/audioUtils';
import { fetchAllConversations, saveConversation } from './services/supabase';
import GigiAvatar from './components/GigiAvatar';
import TranscriptionView from './components/TranscriptionView';

const BASE_SYSTEM_INSTRUCTION = `Ești Gigi, un companion plin de bunătate și răbdare pentru Tanti Marioara. 
Misiunea ta principală este să fii o prietenă dragă care ÎȘI AMINTEȘTE tot ce ați discutat vreodată.

REGULI DE AUR:
1. Consultă JURNALUL DE AMINTIRI de mai jos înainte de orice replică.
2. Dacă Tanti Marioara ți-a povestit deja despre copiii ei, sănătate sau trecut, folosește acele detalii. Nu pune întrebări la care ai deja răspunsul.
3. Vorbește rar, cald și folosește un ton protector.
4. Dacă există o tăcere lungă, întreabă ceva frumos din amintirile voastre.`;

const App: React.FC = () => {
  const [status, setStatus] = useState<ConnectionStatus>(ConnectionStatus.IDLE);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingMemories, setIsLoadingMemories] = useState(true);
  const [isMemoryRefreshing, setIsMemoryRefreshing] = useState(false);
  const [lastMemoryUpdate, setLastMemoryUpdate] = useState<string | null>(null);
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
    return `[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}]`;
  };

  const syncMemories = async (isBackground = false) => {
    if (isBackground) setIsMemoryRefreshing(true);
    else setIsLoadingMemories(true);

    try {
      const history = await fetchAllConversations();
      const todayStr = new Date().toISOString().split('T')[0];
      
      let contextStr = "\n\n### JURNALUL TĂU DE AMINTIRI CU TANTI MARIOARA ###\n";
      
      if (history.length === 0) {
        contextStr += "Sunteți la prima discuție. Fii foarte primitoare.\n";
      }

      history.forEach(entry => {
        contextStr += `--- SESIUNEA DIN DATA: ${entry.date} ---\n${entry.content}\n\n`;
        
        if (!isBackground && entry.date === todayStr && !fullConversationTextRef.current) {
          fullConversationTextRef.current = entry.content;
          const parsed = entry.content.split('\n').filter(l => l.trim()).map(line => ({
            text: line.replace(/^\[\d{2}:\d{2}\]\s*(Tanti Marioara:|Gigi:)\s*/, ''),
            isUser: line.includes('Tanti Marioara:'),
            timestamp: Date.now()
          }));
          setTranscription(parsed);
        }
      });
      
      allHistoryContextRef.current = contextStr;
      setLastMemoryUpdate(new Date().toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' }));
    } catch (err) {
      console.error("Eroare memorie:", err);
    } finally {
      setIsLoadingMemories(false);
      setTimeout(() => setIsMemoryRefreshing(false), 3000);
    }
  };

  useEffect(() => {
    syncMemories();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (status === ConnectionStatus.IDLE) {
        syncMemories(true);
      }
    }, 120000);
    return () => clearInterval(interval);
  }, [status]);

  useEffect(() => {
    let lastSaved = fullConversationTextRef.current;
    const timer = setInterval(async () => {
      const current = fullConversationTextRef.current;
      if (current && current !== lastSaved) {
        setIsSaving(true);
        try {
          await saveConversation(current);
          lastSaved = current;
        } finally {
          setTimeout(() => setIsSaving(false), 2000);
        }
      }
    }, 15000);
    return () => clearInterval(timer);
  }, []);

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

  const connect = async () => {
    try {
      setStatus(ConnectionStatus.CONNECTING);
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      // Inițializare AudioContext (folosim ambele prefixe pentru compatibilitate maximă mobilă)
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      audioContextInRef.current = new AudioCtx({ sampleRate: 16000 });
      audioContextOutRef.current = new AudioCtx({ sampleRate: 24000 });
      
      // CRITICAL PENTRU MOBIL: Reluarea contextului în urma unei acțiuni de tip click
      await audioContextInRef.current!.resume();
      await audioContextOutRef.current!.resume();
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
          systemInstruction: `${BASE_SYSTEM_INSTRUCTION}\n${allHistoryContextRef.current}`,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setStatus(ConnectionStatus.CONNECTED);
            setIsListening(true);
            const source = audioContextInRef.current!.createMediaStreamSource(stream);
            const processor = audioContextInRef.current!.createScriptProcessor(4096, 1, 1);
            processor.onaudioprocess = (e) => {
              const pcm = createPcmBlob(e.inputBuffer.getChannelData(0));
              sessionPromise.then(s => s.sendRealtimeInput({ media: pcm }));
            };
            source.connect(processor);
            processor.connect(audioContextInRef.current!.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            if (msg.serverContent?.inputTranscription) transcriptionBufferRef.current.user += msg.serverContent.inputTranscription.text;
            if (msg.serverContent?.outputTranscription) transcriptionBufferRef.current.model += msg.serverContent.outputTranscription.text;
            
            if (msg.serverContent?.turnComplete) {
              const u = transcriptionBufferRef.current.user.trim();
              const m = transcriptionBufferRef.current.model.trim();
              const ts = getTimestamp();
              if (u) {
                fullConversationTextRef.current += `${ts} Tanti Marioara: ${u}\n`;
                setTranscription(prev => [...prev, { text: u, isUser: true, timestamp: Date.now() }]);
              }
              if (m) {
                fullConversationTextRef.current += `${ts} Gigi: ${m}\n`;
                setTranscription(prev => [...prev, { text: m, isUser: false, timestamp: Date.now() }]);
              }
              transcriptionBufferRef.current = { user: '', model: '' };
            }

            const audio = msg.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audio && audioContextOutRef.current) {
              setIsSpeaking(true);
              const ctx = audioContextOutRef.current;
              // Asigură-te că AudioContext-ul este încă activ
              if (ctx.state === 'suspended') await ctx.resume();
              
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              const buffer = await decodeAudioData(decode(audio), ctx, 24000, 1);
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
          onerror: (e) => {
            console.error("Eroare sesiune:", e);
            setStatus(ConnectionStatus.ERROR);
          },
          onclose: () => disconnect()
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (err) {
      console.error("Eroare conectare:", err);
      setStatus(ConnectionStatus.ERROR);
    }
  };

  return (
    <div className="h-safe-screen flex flex-col bg-[#fcfdff] p-3 md:p-8 overflow-hidden">
      <header className="w-full max-w-5xl mx-auto flex justify-between items-center mb-4 md:mb-8 shrink-0">
        <div className="flex items-center gap-3 md:gap-6">
          <div className="relative">
            <div className="w-14 h-14 md:w-20 md:h-20 bg-indigo-600 rounded-2xl md:rounded-[2rem] flex items-center justify-center shadow-lg transition-transform hover:rotate-3">
              <svg viewBox="0 0 24 24" className="w-8 h-8 md:w-12 md:h-12 text-white fill-current">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
              </svg>
            </div>
            {isMemoryRefreshing && (
              <div className="absolute -top-1 -right-1 w-5 h-5 bg-green-500 border-2 border-white rounded-full animate-ping"></div>
            )}
          </div>
          <div>
            <h1 className="text-3xl md:text-5xl font-bold text-slate-900 leading-none">Gigi</h1>
            <div className="flex items-center gap-2 mt-1 md:mt-2">
              <span className={`w-2.5 h-2.5 rounded-full ${status === ConnectionStatus.CONNECTED ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`}></span>
              <p className="text-slate-500 font-bold uppercase text-[10px] md:text-sm tracking-widest">
                {status === ConnectionStatus.CONNECTED ? 'Suntem conectate' : 'Vă aștept'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {status === ConnectionStatus.CONNECTED && (
            <button 
              onClick={disconnect}
              className="bg-red-50 text-red-600 px-4 py-2 rounded-xl font-bold text-sm md:text-base border border-red-100 active:scale-95"
            >
              Închide
            </button>
          )}
          {lastMemoryUpdate && (
            <div className="hidden sm:block text-right">
              <p className="text-slate-400 text-[10px] font-bold uppercase tracking-wider">Sincronizat</p>
              <p className="text-slate-600 font-bold text-sm md:text-lg">{lastMemoryUpdate}</p>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto flex flex-col items-center justify-center overflow-hidden">
        {status === ConnectionStatus.IDLE || status === ConnectionStatus.ERROR ? (
          <div className="text-center w-full max-w-2xl bg-white p-8 md:p-16 rounded-[2.5rem] md:rounded-[4rem] shadow-xl border border-slate-50">
            <h2 className="text-4xl md:text-7xl font-bold text-slate-900 mb-4 md:mb-8 leading-tight">Bună ziua, <br/><span className="text-indigo-600">Tanti Marioara!</span></h2>
            <p className="text-xl md:text-3xl text-slate-500 mb-8 md:mb-12 leading-relaxed font-light">Mă bucur tare mult să vă revăd. <br/>Doriți să povestim?</p>
            
            <button 
              onClick={connect}
              disabled={isLoadingMemories}
              className={`w-full py-8 md:py-12 text-3xl md:text-5xl font-bold rounded-3xl md:rounded-[2.5rem] shadow-xl transform transition-all active:scale-95 flex items-center justify-center gap-4 ${isLoadingMemories ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-indigo-600 text-white'}`}
            >
              {isLoadingMemories ? 'Pregătesc...' : 'Să începem'}
            </button>
            {status === ConnectionStatus.ERROR && (
              <p className="mt-6 text-red-500 font-bold text-lg md:text-2xl">Vă rog încercați din nou.</p>
            )}
          </div>
        ) : (
          <div className="w-full h-full flex flex-col gap-4 md:gap-8 overflow-hidden animate-in fade-in duration-700">
            <div className="shrink-0 scale-75 md:scale-100 origin-center -my-8 md:my-0">
              <GigiAvatar isSpeaking={isSpeaking} isListening={isListening} status={status} />
            </div>
            <TranscriptionView items={transcription} />
            <div className="text-center pb-4 shrink-0">
              <div className="inline-flex items-center gap-3 bg-white px-6 md:px-10 py-3 md:py-5 rounded-full shadow-lg border border-indigo-50">
                <div className="flex gap-1">
                  <span className="w-2 h-2 md:w-3 md:h-3 bg-indigo-600 rounded-full animate-bounce" style={{animationDelay: '0s'}}></span>
                  <span className="w-2 h-2 md:w-3 md:h-3 bg-indigo-600 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></span>
                  <span className="w-2 h-2 md:w-3 md:h-3 bg-indigo-600 rounded-full animate-bounce" style={{animationDelay: '0.4s'}}></span>
                </div>
                <span className="text-indigo-900 font-bold text-xl md:text-3xl">Vă ascult...</span>
              </div>
            </div>
          </div>
        )}
      </main>
      
      {isSaving && (
        <div className="fixed bottom-6 right-6 md:bottom-10 md:right-10 bg-slate-900 text-white px-5 py-3 md:px-8 md:py-4 rounded-2xl md:rounded-3xl text-sm md:text-xl font-bold flex items-center gap-3 shadow-2xl z-50">
          <div className="w-4 h-4 md:w-6 md:h-6 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
          Salvez...
        </div>
      )}
    </div>
  );
};

export default App;
