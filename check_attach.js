require('dotenv').config({ path: 'F:\\download app hr\\.env' });
const { getSupabaseAdmin } = require('F:\\download app hr\\lib\\supabase-client');

async function main() {
  const sb = getSupabaseAdmin();
  
  // Check attachments table
  const { data, error } = await sb.from('sales_attachments').select('id, sale_id, kind, file_name, created_at').limit(5);
  if (error) {
    console.error('Error:', error.message);
    return;
  }
  console.log('Sample attachments:');
  for (const a of data || []) {
    console.log(`  ${a.id.slice(0,8)} | sale:${(a.sale_id||'').slice(0,8)} | kind:${a.kind} | file:${a.file_name} | created:${a.created_at}`);
  }
  
  // Count by created_at date
  const { data: all, error: countErr } = await sb.from('sales_attachments').select('id, created_at');
  if (countErr) { console.error('Count error:', countErr.message); return; }
  
  const before28 = (all || []).filter(a => {
    const d = String(a.created_at || '').slice(0, 10);
    return d < '2026-06-28';
  });
  const onOrAfter28 = (all || []).filter(a => {
    const d = String(a.created_at || '').slice(0, 10);
    return d >= '2026-06-28';
  });
  
  console.log(`\nTotal attachments: ${all?.length || 0}`);
  console.log(`Before June 28: ${before28.length}`);
  console.log(`June 28 or after: ${onOrAfter28.length}`);
  
  if (before28.length) {
    console.log('\nFirst 10 to delete:');
    before28.slice(0, 10).forEach(a => {
      console.log(`  ${a.id} | ${a.created_at}`);
    });
  }
}

main().catch(console.error);
