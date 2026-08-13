require('dotenv').config({ path: 'F:\\download app hr\\.env' });

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  // Quick check by trying to update a known sale with a string price
  // Use the broken sale that we already fixed earlier - update it again
  const testId = '51f9f93d-6740-4014-af7b-90577d9ffff1';
  
  const currentData = await fetch(`${url}/rest/v1/sales?id=eq.${testId}&select=id,price,client,device`, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
  });
  const current = await currentData.json();
  console.log('Current:', JSON.stringify(current));
  
  // Try PATCH with string price
  const body = JSON.stringify({ price: "$44.95 (Smartwatch) Med Guard Alert", updated_at: new Date().toISOString() });
  
  const response = await fetch(`${url}/rest/v1/sales?id=eq.${testId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Prefer': 'return=minimal',
    },
    body,
  });
  
  console.log('Patch Status:', response.status);
  const text = await response.text();
  console.log('Patch Response:', text.slice(0, 2000));
  
  // Now revert it back to the correct value
  const revert = JSON.stringify({ price: "44.95", updated_at: new Date().toISOString() });
  const revertResponse = await fetch(`${url}/rest/v1/sales?id=eq.${testId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Prefer': 'return=minimal',
    },
    body: revert,
  });
  console.log('Revert Status:', revertResponse.status);
  console.log('Revert Response:', await revertResponse.text());
}
main().catch(console.error);
