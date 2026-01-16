
import { createClient } from '@supabase/supabase-js';

// Folosim o abordare sigură pentru a accesa variabilele de mediu
// În unele medii (Vite), acestea pot fi în import.meta.env, în altele în process.env
const getEnv = (key: string): string | undefined => {
  let value: string | undefined;
  
  try {
    // Încercăm process.env (standard Node/CJS/Vercel)
    // @ts-ignore
    if (typeof process !== 'undefined' && process.env) {
      value = process.env[key];
    }
    
    // Dacă nu am găsit, încercăm import.meta.env (standard Vite/ESM)
    // Am adăugat cast la any pentru a evita eroarea TS: Property 'env' does not exist on type 'ImportMeta'
    // @ts-ignore
    if (!value && typeof import.meta !== 'undefined' && (import.meta as any).env) {
      value = (import.meta as any).env[key];
    }
  } catch (e) {
    console.debug(`Nu s-a putut accesa variabila ${key}:`, e);
  }
  
  return value;
};

const supabaseUrl = getEnv('VITE_SUPABASE_URL');
const supabaseAnonKey = getEnv('VITE_SUPABASE_ANON_KEY');

// Verificăm dacă avem valorile necesare pentru inițializare
const isConfigured = !!supabaseUrl && !!supabaseAnonKey;

export const supabase = isConfigured 
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

/**
 * Salvează sau actualizează conversația zilei curente.
 */
export async function saveConversation(content: string) {
  if (!content) return;
  
  if (!supabase) {
    console.warn("⚠️ SUPABASE: Configurare incompletă. Verifică variabilele VITE_SUPABASE_URL și VITE_SUPABASE_ANON_KEY în setările proiectului.");
    return;
  }

  const today = new Date().toISOString().split('T')[0];

  try {
    const { error } = await supabase
      .from('daily_conversations')
      .upsert(
        { 
          conversation_date: today, 
          content: content,
          updated_at: new Date().toISOString()
        }, 
        { onConflict: 'conversation_date' }
      );

    if (error) {
      if (error.code === '401' || error.message.includes('Invalid API key')) {
        console.error('❌ Supabase 401: Cheia este invalidă.');
        (window as any).SUPABASE_DISABLED = true;
      }
      throw error;
    }
    
    console.log('✅ Conversația a fost salvată cu succes.');
  } catch (err) {
    console.error('Eroare la salvarea în DB:', err);
  }
}
