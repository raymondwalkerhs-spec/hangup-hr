require('dotenv').config({ path: 'F:\\download app hr\\.env' });
const { getSupabaseAdmin } = require('F:\\download app hr\\lib\\supabase-client');

function deviceDisplay(device) {
  const d = String(device || '').trim().toLowerCase();
  if (d === 'smartwatch') return 'Smartwatch';
  if (d === 'necklace') return 'Necklace';
  if (d === 'bracelet') return 'Bracelet';
  return d.charAt(0).toUpperCase() + d.slice(1);
}

async function main() {
  const sb = getSupabaseAdmin();
  
  const { data, error } = await sb.from('sales')
    .select('id, client, device, price, form_data')
    .not('client', 'is', null).neq('client', '')
    .not('device', 'is', null).neq('device', '');
  
  if (error) { console.error('Error:', error.message); return; }
  
  let count = 0;
  for (const r of data || []) {
    const numericPrice = Number(r.price);
    const formatted = Number.isFinite(numericPrice) 
      ? `$${numericPrice.toFixed(2)} (${deviceDisplay(r.device)}) ${r.client}`
      : r.price; // already formatted, keep as is
    
    const fd = r.form_data || {};
    fd.price = formatted;
    
    const { error: e2 } = await sb.from('sales')
      .update({ price: formatted, form_data: fd, updated_at: new Date().toISOString() })
      .eq('id', r.id);
    
    if (e2) {
      console.error('Error updating', r.id.slice(0,8), e2.message);
    } else {
      count++;
    }
  }
  
  console.log(`Updated ${count} sales`);
  
  // Show a few samples
  const { data: samples } = await sb.from('sales')
    .select('id, client, device, price')
    .not('client', 'is', null).neq('client', '')
    .limit(5);
  
  for (const s of samples || []) {
    console.log(`  ${s.id.slice(0,8)} | ${s.price}`);
  }
}

main().catch(console.error);
