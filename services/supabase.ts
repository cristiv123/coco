
import { createClient } from '@supabase/supabase-js';

// Folosim variabilele de mediu din Vercel
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("Atenție: SUPABASE_URL sau SUPABASE_ANON_KEY nu sunt configurate în Environment Variables.");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function saveConversation(content: string) {
  if (!content) return;
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("Nu se poate salva: Configurația Supabase lipsește.");
    return;
  }

  const today = new Date().toISOString().split('T')[0];

  try {
    console.log(`Încercare salvare conversație pentru data: ${today}`);
    
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
      console.error('Eroare detaliată Supabase:', error.message, error.details, error.hint);
      // Dacă eroarea este 404, probabil tabela nu există
      if (error.code === 'PGRST116' || error.message.includes('not found')) {
        console.error('Sfat: Verifică dacă tabela "daily_conversations" a fost creată în Supabase SQL Editor.');
      }
      throw error;
    }
    
    console.log('Conversație salvată cu succes în Supabase:', data);
  } catch (err) {
    console.error('Excepție critică la salvarea în bază de date:', err);
  }
}
