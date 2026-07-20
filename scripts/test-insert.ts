import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.VITE_SUPABASE_ANON_KEY!
);

async function test() {
  const { data, error } = await supabase.from('goats').select('*').limit(1);
  if (error) {
    console.error('Error fetching goats:', error);
  } else {
    console.log('Goat columns:', data && data.length > 0 ? Object.keys(data[0]) : 'No rows, cannot infer schema directly');
  }
}
test().catch(console.error);
