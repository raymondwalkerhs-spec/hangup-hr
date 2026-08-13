require('dotenv').config({ path: 'F:\\download app hr\\.env' });
const { getSupabaseAdmin } = require('F:\\download app hr\\lib\\supabase-client');
const https = require('https');

async function main() {
  const sb = getSupabaseAdmin();
  
  // Get the Supabase URL and service key from env
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY;
  
  if (!supabaseUrl || !serviceKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY');
    return;
  }
  
  const host = supabaseUrl.replace('https://', '');
  const sql = `ALTER TABLE sales ALTER COLUMN price TYPE text USING price::text;`;
  
  const body = JSON.stringify({ query: sql });
  
  const options = {
    hostname: host,
    path: '/rest/v1/rpc/',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
    },
  };
  
  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      console.log('Status:', res.statusCode);
      console.log('Response:', data.slice(0, 500));
    });
  });
  
  req.on('error', (e) => console.error('Error:', e.message));
  req.write(body);
  req.end();
}
main().catch(console.error);
