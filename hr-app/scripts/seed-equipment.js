/**
 * Seed equipment registry from user-provided list.
 * Run: node scripts/seed-equipment.js
 */
require("dotenv").config();
const { getSupabaseAdmin } = require("../lib/supabase-client");

const SEED = [
  { assetTag: "HS3-13", unit: "HS-3", employeeId: null, nameHint: "Jennie", items: [{ type: "headset", description: "Headset" }] },
  { assetTag: "Q03", unit: "HS-3", employeeId: null, nameHint: "Eva Miller", items: [
    { type: "laptop", description: "Laptop" },
    { type: "headset", description: "Headset" },
    { type: "mouse", description: "Mouse" },
  ]},
  { assetTag: "HR-1", unit: "", employeeId: null, nameHint: "Aurora Williams", items: [{ type: "equipment", description: "HR workstation" }] },
  { assetTag: "O1", unit: "", employeeId: null, nameHint: "Oliver White", items: [{ type: "equipment", description: "Workstation" }] },
  { assetTag: "MG1", unit: "", employeeId: null, nameHint: "Raymond Friday", items: [{ type: "equipment", description: "Workstation" }] },
];

async function resolveEmployeeId(db, hint) {
  const { data } = await db.from("employees").select("id, american_name, arabic_name");
  const lower = String(hint || "").toLowerCase();
  const match = (data || []).find((e) => {
    const am = String(e.american_name || "").toLowerCase();
    const ar = String(e.arabic_name || "").toLowerCase();
    return am.includes(lower) || ar.includes(lower) || e.id.toLowerCase().includes(lower);
  });
  return match?.id || null;
}

async function main() {
  const db = getSupabaseAdmin();
  for (const row of SEED) {
    const employeeId = row.employeeId || (await resolveEmployeeId(db, row.nameHint));
    for (const item of row.items) {
      const tag = row.items.length > 1 ? `${row.assetTag}-${item.type}` : row.assetTag;
      const { data: existing } = await db.from("equipment").select("id").eq("asset_tag", tag).maybeSingle();
      let equipmentId = existing?.id;
      if (!equipmentId) {
        const { data: created, error } = await db
          .from("equipment")
          .insert({
            asset_tag: tag,
            unit: row.unit || "",
            item_type: item.type,
            description: item.description,
            notes: row.nameHint ? `Assigned to ${row.nameHint}` : "",
          })
          .select("id")
          .single();
        if (error) throw error;
        equipmentId = created.id;
        console.log(`Created equipment ${tag}`);
      } else {
        console.log(`Equipment ${tag} already exists`);
      }
      if (employeeId) {
        const { data: assigned } = await db
          .from("equipment_assignments")
          .select("id")
          .eq("equipment_id", equipmentId)
          .is("returned_at", null)
          .maybeSingle();
        if (!assigned) {
          const { error: aErr } = await db.from("equipment_assignments").insert({
            equipment_id: equipmentId,
            employee_id: employeeId,
            assigned_by: "seed-equipment",
          });
          if (aErr) throw aErr;
          console.log(`Assigned ${tag} → ${employeeId}`);
        }
      } else {
        console.warn(`No employee match for ${row.nameHint} (${tag})`);
      }
    }
  }
  console.log("Equipment seed complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
