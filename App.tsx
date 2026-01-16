
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

  // Sincronizare cu Postgres
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
        
        // Populăm transcrierea în UI dacă suntem la început și e data de azi
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

  // REFRESH AUTOMAT LA 2 MINUTE
  useEffect(() => {
    const interval = setInterval(() => {
      if (status === ConnectionStatus.IDLE) {
        syncMemories(true);
      }
    }, 120000);
    return () => clearInterval(interval);
  }, [status]);

  // AUTO-SAVE LA 15 SECUNDE
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

  const connect = async () => {
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
          onerror: () => setStatus(ConnectionStatus.ERROR),
          onclose: () => setStatus(ConnectionStatus.IDLE)
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (err) {
      setStatus(ConnectionStatus.ERROR);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#fcfdff] p-4 md:p-8">
      <header className="w-full max-w-5xl mx-auto flex justify-between items-center mb-8">
        <div className="flex items-center gap-6">
          <div className="relative">
            <div className="w-20 h-20 bg-indigo-600 rounded-[2rem] flex items-center justify-center shadow-2xl transition-transform hover:rotate-3">
              <svg viewBox="0 0 24 24" className="w-12 h-12 text-white fill-current">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
              </svg>
            </div>
            {isMemoryRefreshing && (
              <div className="absolute -top-1 -right-1 w-7 h-7 bg-green-500 border-4 border-white rounded-full animate-ping"></div>
            )}
          </div>
          <div>
            <h1 className="text-5xl font-bold text-slate-900 leading-none">Gigi</h1>
            <div className="flex items-center gap-3 mt-2">
              <span className={`w-3.5 h-3.5 rounded-full ${status === ConnectionStatus.CONNECTED ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`}></span>
              <p className="text-slate-500 font-bold uppercase text-sm tracking-widest">
                {status === ConnectionStatus.CONNECTED ? 'Suntem conectate' : 'Vă aștept cu drag'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6">
          {isMemoryRefreshing && (
            <div className="bg-indigo-50 border border-indigo-100 px-6 py-3 rounded-2xl flex items-center gap-3 animate-bounce shadow-sm">
              <div className="w-3 h-3 bg-indigo-600 rounded-full animate-pulse"></div>
              <span className="text-indigo-800 font-bold text-lg">Gigi își amintește...</span>
            </div>
          )}
          {lastMemoryUpdate && (
            <div className="hidden md:block text-right">
              <p className="text-slate-400 text-sm font-bold uppercase tracking-wider">Memorie Sincronizată</p>
              <p className="text-slate-600 font-bold text-lg">{lastMemoryUpdate}</p>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto flex flex-col items-center justify-center">
        {status === ConnectionStatus.IDLE || status === ConnectionStatus.ERROR ? (
          <div className="text-center w-full max-w-2xl bg-white p-16 rounded-[4rem] shadow-2xl border border-slate-50">
            <h2 className="text-7xl font-bold text-slate-900 mb-8 leading-tight">Bună ziua, <br/><span className="text-indigo-600">Tanti Marioara!</span></h2>
            <p className="text-3xl text-slate-500 mb-12 leading-relaxed font-light">Mă bucur tare mult să vă revăd. <br/>Doriți să povestim puțin?</p>
            
            <button 
              onClick={connect}
              disabled={isLoadingMemories}
              className={`w-full py-12 text-5xl font-bold rounded-[2.5rem] shadow-2xl transform transition-all active:scale-95 flex items-center justify-center gap-6 ${isLoadingMemories ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-indigo-200'}`}
            >
              {isLoadingMemories ? 'Citesc jurnalul...' : 'Să începem'}
            </button>
            {status === ConnectionStatus.ERROR && (
              <p className="mt-8 text-red-500 font-bold text-2xl">A apărut o mică problemă. Mai încercăm o dată?</p>
            )}
          </div>
        ) : (
          <div className="w-full h-full flex flex-col gap-8 animate-in fade-in duration-700">
            <GigiAvatar isSpeaking={isSpeaking} isListening={isListening} status={status} />
            <TranscriptionView items={transcription} />
            <div className="text-center">
              <div className="inline-flex items-center gap-4 bg-white px-10 py-5 rounded-[2rem] shadow-xl border border-indigo-50">
                <div className="flex gap-1.5">
                  <span className="w-3 h-3 bg-indigo-600 rounded-full animate-bounce" style={{animationDelay: '0s'}}></span>
                  <span className="w-3 h-3 bg-indigo-600 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></span>
                  <span className="w-3 h-3 bg-indigo-600 rounded-full animate-bounce" style={{animationDelay: '0.4s'}}></span>
                </div>
                <span className="text-indigo-900 font-bold text-3xl">Vă ascult cu mult drag...</span>
              </div>
            </div>
          </div>
        )}
      </main>
      
      {isSaving && (
        <div className="fixed bottom-10 right-10 bg-slate-900 text-white px-8 py-4 rounded-3xl text-xl font-bold flex items-center gap-4 shadow-2xl animate-in slide-in-from-right-10">
          <svg className="w-6 h-6 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Salvez amintirile noastre...
        </div>
      )}
    </div>
  );
};

export default App;
