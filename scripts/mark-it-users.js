#!/usr/bin/env node
require('dotenv').config();
const { getSupabaseAdmin } = require('../lib/supabase-client');

async function main() {
  const sb = getSupabaseAdmin();
  const args = process.argv.slice(2);
  const want = args.length ? args.map(s => s.toLowerCase()) : ['raymond','q10','o1','suzy'];
  console.log('Marking users as IT:', want);

  const { data, error } = await sb.from('app_users').select('id,username,employee_id,role,status').limit(2000);
  if (error) throw new Error(error.message);

  const matches = (data || []).filter(u => {
    const un = String(u.username || '').toLowerCase();
    const eid = String(u.employee_id || '').toLowerCase();
    return want.includes(un) || want.includes(eid);
  });

  if (!matches.length) {
    console.log('No matching users found for:', want);
    return;
  }

  for (const m of matches) {
    const { error: upErr } = await sb.from('app_users').update({ is_it: true }).eq('id', m.id);
    if (upErr) {
      console.error('UPDATE_ERR', m.username, upErr.message);
    } else {
      console.log('Marked is_it=true for', m.username, m.employee_id || '');
    }
  }

  const ids = matches.map(m => m.id);
  const { data: out } = await sb.from('app_users').select('id,username,employee_id,role,status,is_it').in('id', ids).limit(50);
  console.log('RESULT', JSON.stringify(out || [], null, 2));
}

main().catch(err => { console.error(err && err.message); process.exit(1); });
