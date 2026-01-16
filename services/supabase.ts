
import { createClient } from '@supabase/supabase-js';

/**
 * NOTĂ: Folosim process.env pentru a accesa variabilele setate în Vercel/Vite.
 * Utilizăm prefixul VITE_ conform cerințelor mediului de execuție.
 */
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

// Verificăm dacă avem ambele valori necesare și dacă cheia are formatul JWT (începe cu eyJ)
const isConfigured = !!supabaseUrl && !!supabaseAnonKey && supabaseAnonKey.startsWith('eyJ');

export const supabase = isConfigured 
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

/**
 * Salvează sau actualizează conversația zilei curente.
 */
export async function saveConversation(content: string) {
  if (!content) return;
  
  if (!supabase) {
    console.warn("⚠️ SUPABASE: Configurare incompletă. Verifică variabilele VITE_SUPABASE_URL și VITE_SUPABASE_ANON_KEY.");
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
