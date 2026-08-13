require('dotenv').config();
const { getSupabaseAdmin } = require('./lib/supabase-client');
(async () => {
  try {
    const db = getSupabaseAdmin();
    const { data, error } = await db.from('app_versions').select('*').order('release_date', { ascending: false }).limit(10);
    if (error) {
      console.error('ERROR', error);
      process.exit(1);
    }
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('ERR', err.message || err);
    process.exit(1);
  }
})();
