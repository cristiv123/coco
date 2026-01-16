
import { createClient } from '@supabase/supabase-js';

// Folosim variabilele de mediu din proces, cu fallback la valorile furnizate de utilizator
// Notă: "sb_publishable_..." nu pare a fi o cheie Anon standard Supabase (care e un JWT lung),
// dar o folosim pentru a preveni eroarea "supabaseKey is required".
const supabaseUrl = process.env.SUPABASE_URL || 'https://tnttlfbrzndbjjrvdgbf.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || 'sb_publishable_Kxk_efqx1-foSZ_yMorH7A_6XNSnAvp'; 

// Inițializăm clientul. Dacă cheia este un șir gol, Supabase va arunca o eroare la runtime.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Salvează sau actualizează conversația zilei curente.
 */
export async function saveConversation(content: string) {
  if (!content) return;
  
  // Verificăm dacă cheia pare validă înainte de a încerca salvarea (minimă protecție)
  if (!supabaseAnonKey || supabaseAnonKey === '') {
    console.error("Supabase Anon Key lipsește complet.");
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
        console.error('Eroare Autentificare (401): Cheia furnizată nu are permisiuni sau este invalidă.');
      } else if (error.code === 'PGRST116' || error.message.includes('not found')) {
        console.error('Eroare: Tabela "daily_conversations" nu există în baza de date.');
      } else {
        console.error('Eroare Supabase:', error.message);
      }
      throw error;
    }
    
    console.log('Conversație sincronizată cu succes.');
  } catch (err) {
    console.error('Eroare în fluxul de salvare:', err);
    throw err;
  }
}
