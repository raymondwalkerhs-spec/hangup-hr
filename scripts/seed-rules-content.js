/**
 * Seed rules_content table from hardcoded renderRulesPage() HTML.
 * Run AFTER migration 20260722_v128_phase1_rules_it_meetings_separation.sql.
 *
 * Usage: node scripts/seed-rules-content.js
 */
require("dotenv").config();
const { getSupabaseAdmin } = require("../lib/supabase-client");

const SECTIONS = [
  {
    sectionKey: "lateness",
    title: "Lateness & Deductions",
    sortOrder: 10,
    content: `<table class="rules-table">
  <tr><td>Fingerprint after 2:45</td><td>25 LE (if fingerprint used 2:45–3:00)</td></tr>
  <tr><td>Fingerprint after 3:00 PM</td><td>25 LE per 15 mins after 3:00 PM (in addition to 25 LE for after 2:45)</td></tr>
  <tr><td>Being in company but logged-in after 3:00</td><td>50 LE (Login Lateness)</td></tr>
  <tr><td>No Show No Call (NSNC)</td><td>3 Days</td></tr>
  <tr><td>Leave without 2 Weeks Notice</td><td>2 Weeks penalty</td></tr>
  <tr><td>Day-Off not approved</td><td>3 Days (sick note or exam schedule required for approval)</td></tr>
  <tr><td>Absent during 2 Weeks Notice</td><td>3 Days</td></tr>
  <tr><td>Call to excuse Day-off after 12 PM</td><td>3 Days</td></tr>
  <tr><td>Coming at 3:30</td><td>1/4 Day</td></tr>
  <tr><td>Starting at 5:00</td><td>1/2 Day</td></tr>
  <tr><td>Working 2nd half, starting at 7 sharp</td><td>1/2 Day</td></tr>
  <tr><td>Leave before 7:00</td><td>Whole Day</td></tr>
  <tr><td>Leave after 8:00</td><td>1/2 Day</td></tr>
  <tr><td>Leave after 10:00</td><td>1/4 Day</td></tr>
</table>`,
  },
  {
    sectionKey: "fines",
    title: "General Guidelines — Fines",
    sortOrder: 20,
    content: `<div class="info-note">Deductions doubled if same agent appears in report more than once in the same month.</div>
<table class="rules-table">
  <thead><tr><th>Violation</th><th>1st Time</th><th>2nd Time</th><th>3rd Time</th></tr></thead>
  <tbody>
  <tr><td>Exceeding Away Time (10 min/day max)</td><td>150 LE</td><td>200 LE</td><td>250 LE</td></tr>
  <tr><td>Meeting Lateness</td><td>50 LE</td><td>75 LE</td><td>100 LE</td></tr>
  <tr><td>Break Lateness (after 1 min)</td><td>100 LE</td><td>150 LE</td><td>200 LE</td></tr>
  <tr><td>No Finger Print (Must be IN/OUT)</td><td>50 LE</td><td>75 LE</td><td>100 LE</td></tr>
  <tr><td>Coaching Session Lateness</td><td>75 LE</td><td>100 LE</td><td>125 LE</td></tr>
  <tr><td>Going out without permission (other than break)</td><td>250 LE</td><td>—</td><td>—</td></tr>
  <tr><td>Side Talks / Arabic on floor / Talks during technical issue</td><td>50 LE</td><td>75 LE</td><td>100 LE</td></tr>
  <tr><td>Arabic in a call</td><td>100 LE</td><td>200 LE</td><td>300 LE</td></tr>
  <tr><td>Loud Voice</td><td>50 LE</td><td>75 LE</td><td>100 LE</td></tr>
  <tr><td>Private Chats</td><td>50 LE</td><td>100 LE</td><td>150 LE</td></tr>
  <tr><td>No CC for HR Email (hr@hangupsolutions.com)</td><td colspan="3">Request rejected &amp; multiplied by 3</td></tr>
  <tr><td>Arguing about instructions / Not following TL instructions</td><td>100 LE</td><td>150 LE</td><td>200 LE</td></tr>
  <tr><td>Dialer abuse</td><td>100 LE</td><td>200 LE</td><td>300 LE</td></tr>
  <tr><td>Changing Pause code for someone else</td><td>100 LE</td><td>200 LE</td><td>300 LE</td></tr>
  <tr><td>Wrong disposition / wrong pause code</td><td>50 LE</td><td>50 LE</td><td>50 LE</td></tr>
  <tr><td>Not closing dialer &amp; shutting down PC after shift</td><td>100 LE</td><td>200 LE</td><td>300 LE</td></tr>
  <tr><td>Shuffling / Skipping calls (Wasting time)</td><td>300 LE</td><td>400 LE</td><td>500 LE</td></tr>
  <tr><td>Disposition/Pause/Dead Call for long time (45 min total)</td><td>100 LE</td><td>200 LE</td><td>300 LE</td></tr>
  <tr><td>Using WC for something else (+WC cancelled for week)</td><td>50 LE</td><td>100 LE</td><td>200 LE</td></tr>
  <tr><td>Using WC right after break without approval</td><td>50 LE</td><td>100 LE</td><td>200 LE</td></tr>
  <tr><td>IT Technical pause without informing IT &amp; RTM</td><td>50 LE</td><td>75 LE</td><td>100 LE</td></tr>
  <tr><td>Working from Home without IT Approval</td><td>100 LE</td><td>150 LE</td><td>200 LE</td></tr>
  <tr><td>Private windows (Streaming / Social media / Books)</td><td>50 LE</td><td>100 LE</td><td>150 LE</td></tr>
  <tr><td>Smoking in non-smoking areas (Break Area, etc.)</td><td>100 LE</td><td>250 LE</td><td>500 LE</td></tr>
  <tr><td>Leaving &gt;5 people / Using elevator (per member)</td><td>100 LE</td><td>250 LE</td><td>350 LE</td></tr>
  <tr><td>Messing with AC (off, temp change, windows while AC on)</td><td>150 LE</td><td>200 LE</td><td>250 LE</td></tr>
  <tr><td>Using Cell Phone</td><td>100 LE</td><td>150 LE</td><td>200 LE</td></tr>
  <tr><td>Using normal non-sealed cup / Mug</td><td>100 LE</td><td>150 LE</td><td>200 LE</td></tr>
  <tr><td>Leaving floor without permission</td><td>100 LE</td><td>150 LE</td><td>200 LE</td></tr>
  <tr><td>Eating in the floor (chips / sandwiches / ice cream / snacks)</td><td>100 LE</td><td>150 LE</td><td>200 LE</td></tr>
  <tr><td>Eating in Training Room</td><td>100 LE</td><td>150 LE</td><td>200 LE</td></tr>
  <tr><td>Leaving floor while someone else out (2 away-WC same team)</td><td>25 LE</td><td>50 LE</td><td>100 LE</td></tr>
  <tr><td>Transparent/revealing clothes, crop tops, ripped jeans, skirts above knee, slippers/flipflops</td><td>150 LE</td><td>250 LE</td><td>350 LE</td></tr>
  <tr><td>Coffee/food spill left on stove</td><td>100 LE</td><td>100 LE</td><td>100 LE</td></tr>
  <tr><td>UnCleanliness (trash on station / unwashed dishes)</td><td>250 LE</td><td>300 LE</td><td>350 LE</td></tr>
  <tr><td>Standing on stairs / Out of company</td><td>100 LE</td><td>100 LE</td><td>100 LE</td></tr>
  <tr><td>Smoking on stairs (+ previous deduction)</td><td>100 LE</td><td>100 LE</td><td>100 LE</td></tr>
  </tbody>
</table>
<div class="info-note">Not Working Day = UNPAID DAY (Holiday, Day-Off, Technical)</div>`,
  },
  {
    sectionKey: "quality",
    title: "Quality & Fatal Mistakes",
    sortOrder: 30,
    content: `<table class="rules-table">
  <thead><tr><th>Violation</th><th>1st Time</th><th>2nd Time</th><th>3rd Time</th></tr></thead>
  <tbody>
  <tr><td>Attitude (applied by HR per investigation)</td><td>250 LE</td><td>500 LE</td><td>Termination</td></tr>
  <tr><td>Miss-use chairs/couches/tables/stations</td><td>250 LE</td><td>300 LE</td><td>350 LE</td></tr>
  <tr><td>Downloading software/app without IT/RTM permission</td><td>100 LE</td><td>200 LE</td><td>300 LE</td></tr>
  <tr><td>Spreading negativity</td><td>150 LE</td><td>250 LE</td><td>500 LE</td></tr>
  <tr><td>Arguing about applied deduction</td><td>150 LE</td><td>250 LE</td><td>500 LE</td></tr>
  <tr><td>Submitting Sale for someone else</td><td>500 LE</td><td>750 LE</td><td>Termination</td></tr>
  <tr><td>Religious / Political / Sexual talks/discussions</td><td>100 LE</td><td>500 LE</td><td>Termination</td></tr>
  <tr><td>Leaking company information (checks/sheets)</td><td>400 LE</td><td>600 LE</td><td>Termination</td></tr>
  <tr><td>Transferring lead without checking DNC</td><td>500 LE</td><td>1000 LE</td><td>Termination</td></tr>
  <tr><td>Not submitting 3 forms (Internal / Tracking / Live transfer)</td><td>100 LE</td><td>150 LE</td><td>200 LE</td></tr>
  <tr><td>Mislead PT: False info / Wrong description</td><td>250 LE</td><td>350 LE</td><td>500 LE</td></tr>
  <tr><td>"We are MedGuard" / Client misrepresentation</td><td>250 LE</td><td>350 LE</td><td>500 LE</td></tr>
  <tr><td>Offering option to cancel subscription</td><td>250 LE</td><td>350 LE</td><td>500 LE</td></tr>
  </tbody>
</table>`,
  },
  {
    sectionKey: "notice_period",
    title: "Two Weeks Rules (Notice Period)",
    sortOrder: 40,
    content: `<ul>
  <li>Any absence / lateness (even if TL-approved) is multiplied by 3.</li>
  <li>All pause requests must be submitted on Friday.</li>
  <li>Pause period calculated from following Monday to Friday, regardless of weeks requested.</li>
  <li>Automatically on an action plan during the 2 weeks notice.</li>
  <li>Must achieve <strong>10 passed sales</strong> in two weeks.</li>
  <li>Minimum <strong>5 passed sales</strong> to guarantee 50% of the 2 weeks payment.</li>
  <li>Failing minimum → cancellation of 2 weeks payment.</li>
  <li>10 days salary withheld during pause; returned after completing 10 working days on return.</li>
  <li>You may withdraw your notice at any time during the two weeks.</li>
</ul>`,
  },
  {
    sectionKey: "pausing",
    title: "Pausing Rules",
    sortOrder: 50,
    content: `<ul>
  <li>25 LE deducted per 15 mins after 3:00 PM (in addition to 25 LE for fingerprint after 2:45).</li>
  <li>Allowance times changeable by management, modified on dashboard weekly.</li>
  <li>Deductions subject to change by upper management.</li>
  <li>Allowance: 10+ mins (10–15), 15+ mins (15–20), 20+ mins.</li>
</ul>`,
  },
  {
    sectionKey: "additional_policies",
    title: "Additional Policies",
    sortOrder: 60,
    content: `<ul>
  <li><strong>Smoking:</strong> Allowed in balcony only.</li>
  <li><strong>Elevator:</strong> Max 5 people at once.</li>
  <li><strong>Door policy (Makram site):</strong> Not allowed to step out if 5+ people already outside.</li>
  <li><strong>Attitude violations</strong> are only applied by HR according to investigation.</li>
</ul>`,
  },
];

async function seedRulesContent() {
  const db = getSupabaseAdmin();

  for (const company of ["hangup", "hs2"]) {
    for (const section of SECTIONS) {
      const existing = await db
        .from("rules_content")
        .select("id")
        .eq("company", company)
        .eq("section_key", section.sectionKey)
        .maybeSingle();

      if (existing.data) {
        console.log(`Skipping ${company}/${section.sectionKey} — already exists`);
        continue;
      }

      const { error } = await db.from("rules_content").insert({
        company,
        section_key: section.sectionKey,
        title: section.title,
        content: section.content,
        sort_order: section.sortOrder,
      });

      if (error) {
        console.error(`Error inserting ${company}/${section.sectionKey}:`, error.message);
      } else {
        console.log(`Seeded ${company}/${section.sectionKey}`);
      }
    }
  }

  console.log("Done seeding rules_content.");
}

seedRulesContent().catch((err) => {
  console.error(err);
  process.exit(1);
});
