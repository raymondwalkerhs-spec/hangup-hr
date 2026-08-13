require('dotenv').config({ path: 'F:\\download app hr\\.env' });
const { getSupabaseAdmin } = require('F:\\download app hr\\lib\\supabase-client');
async function main() {
  const sb = getSupabaseAdmin();
  // Raw SQL to check column type
  const { data, error } = await sb.rpc('exec_sql', { query: "SELECT data_type, udt_name FROM information_schema.columns WHERE table_name = 'sales' AND column_name = 'price'" });
  if (error) {
    console.log('RPC error:', error.message);
    // Try a direct select to see the type
    const { data: d2, error: e2 } = await sb.from('sales').select('price').limit(1);
    if (e2) { console.error(e2.message); return; }
    console.log('price value type:', typeof d2?.[0]?.price, JSON.stringify(d2?.[0]?.price));
  } else {
    console.log(JSON.stringify(data));
  }
}
main().catch(console.error);
