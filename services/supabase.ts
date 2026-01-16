
import { createClient } from '@supabase/supabase-js';

// Citim variabilele direct din proces. În Vercel, acestea sunt injectate automat.
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

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
    // Mesaj de diagnosticare dacă configurarea lipsește
    if (!supabaseUrl || !supabaseAnonKey) {
      console.warn("⚠️ SUPABASE: Variabilele SUPABASE_URL sau SUPABASE_ANON_KEY lipsesc din Environment Variables.");
    } else if (!supabaseAnonKey.startsWith('eyJ')) {
      console.warn("⚠️ SUPABASE: Cheia anon furnizată nu are formatul corect (trebuie să înceapă cu 'eyJ').");
    }
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
        console.error('❌ Supabase 401: Cheia este invalidă sau proiectul a fost suspendat.');
        (window as any).SUPABASE_DISABLED = true;
      } else {
        console.error('❌ Eroare Supabase:', error.message);
      }
      throw error;
    }
    
    console.log('✅ Conversația a fost salvată în baza de date.');
  } catch (err) {
    // Nu blocăm interfața dacă salvarea eșuează
    console.error('Eroare la salvarea în DB:', err);
  }
}
