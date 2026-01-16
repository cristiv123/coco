
import { createClient } from '@supabase/supabase-js';

// NOTĂ IMPORTANTĂ: Cheia care începe cu "sb_publishable_" pare a fi o cheie Stripe sau Clerk.
// Pentru Supabase, mergi în Dashboard -> Project Settings -> API și caută "anon" "public".
// Trebuie să fie un șir foarte lung care începe cu "eyJ...".
const supabaseUrl = process.env.SUPABASE_URL || 'https://tnttlfbrzndbjjrvdgbf.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || 'sb_publishable_Kxk_efqx1-foSZ_yMorH7A_6XNSnAvp'; 

// Verificăm dacă cheia are formatul corect de Supabase (JWT - începe cu eyJ)
const isKeyPotentiallyValid = supabaseAnonKey.startsWith('eyJ');

export const supabase = isKeyPotentiallyValid 
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

/**
 * Salvează sau actualizează conversația zilei curente.
 */
export async function saveConversation(content: string) {
  if (!content) return;
  
  if (!supabase) {
    if (supabaseAnonKey.startsWith('sb_publishable')) {
      console.warn("⚠️ EROARE CONFIGURARE: Folosești o cheie de tip 'sb_publishable' (probabil Stripe/Clerk). Supabase are nevoie de cheia 'anon' 'public' care începe cu 'eyJ'. Salvarea este dezactivată până la remediere.");
    } else {
      console.warn("⚠️ Supabase nu este configurat (lipsește cheia). Salvarea dezactivată.");
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
        console.error('❌ Supabase 401: Cheia furnizată este invalidă. Verifică Dashboard -> Settings -> API -> anon public.');
        // Dezactivăm viitoarele încercări în această sesiune pentru a nu spama consola
        (window as any).SUPABASE_DISABLED = true;
      }
      throw error;
    }
    
    console.log('✅ Amintiri sincronizate în baza de date.');
  } catch (err) {
    console.error('Eroare în fluxul de salvare:', err);
    throw err;
  }
}
