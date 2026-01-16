
import { createClient } from '@supabase/supabase-js';

// Coordonate furnizate pentru integrarea completă
const supabaseUrl = 'https://tnttlfbrzndbjjrvdgbf.supabase.co';
const supabaseAnonKey = 'sb_publishable_Kxk_efqx1-foSZ_yMorH7A_6XNSnAvp';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Salvează sau actualizează conversația zilei curente.
 * Tabela 'daily_conversations' trebuie să aibă coloana 'conversation_date' setată ca UNIQUE.
 */
export async function saveConversation(content: string) {
  if (!content) return;

  const today = new Date().toISOString().split('T')[0];

  try {
    console.log(`Gigi încearcă să salveze amintirile pentru data: ${today}...`);
    
    const { data, error } = await supabase
      .from('daily_conversations')
      .upsert(
        { 
          conversation_date: today, 
          content: content,
          updated_at: new Date().toISOString()
        }, 
        { onConflict: 'conversation_date' }
      )
      .select();

    if (error) {
      console.error('Eroare la salvarea în Supabase:', error.message);
      // Notă: Dacă primești eroare 404 sau "relation not found", 
      // asigură-te că ai creat tabela daily_conversations în dashboard-ul Supabase.
      throw error;
    }
    
    console.log('Conversație salvată cu succes.');
  } catch (err) {
    console.error('Eroare critică la serviciul de salvare:', err);
  }
}
