require("dotenv").config();
const { getSupabaseAdmin } = require("../lib/supabase-client");
const { validateMemberId } = require("../lib/rpm-member-id");

async function main() {
  const db = getSupabaseAdmin();
  const { data, error } = await db.from("rpm_sales").select("id, agent_id, working_day, member_id, created_at");
  if (error) throw error;
  const invalid = [];
  for (const row of data || []) {
    const r = validateMemberId(row.member_id || "", { required: true });
    if (!r.ok) {
      invalid.push({
        id: row.id,
        agentId: row.agent_id,
        day: row.working_day,
        memberId: row.member_id || "",
        reason: r.message,
      });
    }
  }
  console.log(JSON.stringify({ total: (data || []).length, invalidCount: invalid.length, invalid }, null, 2));
  if (invalid.length) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
