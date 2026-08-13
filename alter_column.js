require('dotenv').config({ path: 'F:\\download app hr\\.env' });

async function main() {
  const url = process.env.SUPABASE_URL; // https://ugntjwqimgosuiodsnnk.supabase.co
  const ref = url.replace('https://', '').split('.')[0]; // ugntjwqimgosuiodsnnk
  const token = process.env.SUPABASE_ACCESS_TOKEN; // sbp_...
  
  console.log('Project ref:', ref);
  
  // SQL to alter column type
  const sql = `ALTER TABLE sales ALTER COLUMN price TYPE text USING price::text;`;
  
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ query: sql }),
  });
  
  console.log('Status:', response.status);
  const text = await response.text();
  console.log('Response:', text.slice(0, 2000));
}
main().catch(console.error);
