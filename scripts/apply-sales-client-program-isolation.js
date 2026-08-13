require("dotenv").config();
const { getSupabaseAdmin } = require("../lib/supabase-client");

async function main() {
  const db = getSupabaseAdmin();
  const { data: rpmClients, error } = await db
    .from("sales_clients")
    .select("id, name, sale_program")
    .or("name.ilike.rpm1,name.ilike.rpm2");
  if (error) throw error;

  for (const row of rpmClients || []) {
    if (row.sale_program === "rpm") continue;
    const { error: upErr } = await db
      .from("sales_clients")
      .update({ sale_program: "rpm", updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (upErr) console.warn(row.name, upErr.message);
    else console.log(`Set ${row.name} → rpm`);
  }

  const { data: check } = await db.from("sales_clients").select("name, sale_program").ilike("name", "rpm%");
  console.log("RPM clients:", check);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
