require('dotenv').config({ path: 'F:\\download app hr\\.env' });
const { getSupabaseAdmin } = require('F:\\download app hr\\lib\\supabase-client');

async function main() {
  const sb = getSupabaseAdmin();
  
  // Join attachments with sales to check sale dates
  const { data, error } = await sb.from('sales_attachments')
    .select('id, sale_id, created_at, kind, file_name')
    .order('created_at', { ascending: true })
    .limit(255);
  
  if (error) { console.error('Error:', error.message); return; }
  
  // Check all attachment creation dates
  const dates = [...new Set((data || []).map(a => String(a.created_at || '').slice(0,10)))].sort();
  console.log('Attachment date buckets:', dates.join(', '));
  console.log('Total:', data?.length);
  
  // Also check if there are associated Dropbox files or local storage
  // Look at app to see how files are stored
  const { data: sample } = await sb.from('sales_attachments')
    .select('id, dropbox_path, dropbox_link, file_name')
    .limit(3);
  
  if (sample?.length) {
    console.log('\nStorage info:');
    for (const a of sample) {
      console.log(`  ${a.id.slice(0,8)} | dropbox_path:${a.dropbox_path || 'null'} | dropbox_link:${(a.dropbox_link||'').slice(0,60)} | file:${a.file_name}`);
    }
  }
}

main().catch(console.error);
