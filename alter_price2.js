require('dotenv').config({ path: 'F:\\download app hr\\.env' });
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  
  // Use raw PostgREST to execute SQL
  // First try to alter the column type via a direct fetch to PostgREST
  const sql = encodeURIComponent(`ALTER TABLE sales ALTER COLUMN price TYPE text USING price::text`);
  const response = await fetch(`${url}/rest/v1/rpc/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': key,
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({ query: sql }),
  });
  
  console.log('Status:', response.status);
  const text = await response.text();
  console.log('Response:', text.slice(0, 500));
}
main().catch(console.error);
