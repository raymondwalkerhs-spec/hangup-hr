require('dotenv').config({ path: 'F:\\download app hr\\.env' });

async function main() {
  const url = process.env.SUPABASE_URL;
  const ref = url.replace('https://', '').split('.')[0];
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  
  // List all tables
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ query: `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name` }),
  });
  
  const data = await response.json();
  console.log('Tables:', data.map(t => t.table_name).join(', '));
  
  // Check for any table with 'attach' in the name
  const response2 = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ query: `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND LOWER(table_name) LIKE '%attach%'` }),
  });
  
  const data2 = await response2.json();
  console.log('Attachment tables:', data2.map(t => t.table_name).join(', '));
}
main().catch(console.error);
