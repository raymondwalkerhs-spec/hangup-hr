/**
 * Script to update existing trainees' employment_date to match their training start date.
 * This fixes the issue where trainees didn't have employment_date set from their training start.
 */
require("dotenv").config();
const { getSupabaseAdmin } = require("../lib/supabase-client");

async function main() {
  const db = getSupabaseAdmin();
  
  console.log("Finding trainees with training programs...");
  
  // Get all training programs with phase1_start
  const { data: programs, error: progErr } = await db
    .from("agent_training_programs")
    .select("employee_id, phase1_start, created_at");
  
  if (progErr) {
    console.error("Error fetching programs:", progErr.message);
    process.exit(1);
  }
  
  if (!programs?.length) {
    console.log("No training programs found.");
    return;
  }
  
  console.log(`Found ${programs.length} training programs.`);
  
  let updated = 0;
  let skipped = 0;
  
  for (const prog of programs) {
    const empId = prog.employee_id;
    const trainingStart = prog.phase1_start || (prog.created_at ? String(prog.created_at).slice(0, 10) : null);
    
    if (!trainingStart) {
      console.log(`  Skipping ${empId}: no training start date`);
      skipped++;
      continue;
    }
    
    // Get current employee
    const { data: emp, error: empErr } = await db
      .from("employees")
      .select("id, employment_date, position")
      .eq("id", empId)
      .maybeSingle();
    
    if (empErr) {
      console.log(`  Error fetching employee ${empId}:`, empErr.message);
      continue;
    }
    
    if (!emp) {
      console.log(`  Employee ${empId} not found, skipping`);
      skipped++;
      continue;
    }
    
    // Only update if employment_date is different from training start
    const currentEmploymentDate = emp.employment_date ? String(emp.employment_date).slice(0, 10) : null;
    
    if (currentEmploymentDate === trainingStart) {
      console.log(`  ${empId}: already matches (${trainingStart})`);
      skipped++;
      continue;
    }
    
    // Update employment_date to training start date
    const { error: updErr } = await db
      .from("employees")
      .update({ employment_date: trainingStart, updated_at: new Date().toISOString() })
      .eq("id", empId);
    
    if (updErr) {
      console.log(`  Error updating ${empId}:`, updErr.message);
      continue;
    }
    
    console.log(`  Updated ${empId}: ${currentEmploymentDate || "null"} -> ${trainingStart}`);
    updated++;
  }
  
  console.log(`\nDone! Updated: ${updated}, Skipped: ${skipped}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
