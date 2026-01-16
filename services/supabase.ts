
import { createClient } from '@supabase/supabase-js';

// Prioritizăm variabilele de mediu din Vercel (SUPABASE_URL și SUPABASE_ANON_KEY)
// Cheia "sb_publishable_..." furnizată anterior pare a fi de la un alt serviciu (ex: Stripe/Clerk).
// Supabase Anon Keys încep de obicei cu "eyJ..."
const supabaseUrl = process.env.SUPABASE_URL || 'https://tnttlfbrzndbjjrvdgbf.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || ''; 

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Salvează sau actualizează conversația zilei curente.
 */
export async function saveConversation(content: string) {
  if (!content) return;
  if (!supabaseAnonKey) {
    console.error("Supabase Anon Key lipsește. Verifică variabilele de mediu în Vercel.");
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
      if (error.code === '401' || error.message.includes('Unauthorized')) {
        console.error('Eroare Autentificare Supabase (401): Cheia ANON este incorectă sau expirată.');
      } else if (error.code === 'PGRST116' || error.message.includes('not found')) {
        console.error('Eroare: Tabela "daily_conversations" nu a fost găsită. Creează tabela în SQL Editor din Supabase.');
      } else {
        console.error('Eroare Supabase:', error.message);
      }
      throw error;
    }
    
    console.log('Amintiri salvate cu succes.');
  } catch (err) {
    console.error('Eroare la procesul de salvare:', err);
    throw err; // Aruncăm eroarea mai departe pentru ca UI-ul să o poată afișa
  }
}
