require("dotenv").config();
const { getSupabaseAdmin } = require("../lib/supabase-client");

const COMPANIES = ["hangup", "hs2"];

const SECTIONS = [
  {
    sectionKey: "lateness",
    title: "Lateness & Deductions",
    sortOrder: 10,
    content: `<table class="rules-table">
  <tr><td>Fingerprint after 2:45</td><td>25 LE will be deducted if the fingerprint is used from 2:45 to 3:00.</td></tr>
  <tr><td>Fingerprint after 3:00 PM</td><td>25 LE for each 15 minutes after 3:00 PM, in addition to the 25 LE for the 2:45 fingerprint.</td></tr>
  <tr><td>Logged in after 3:00</td><td>50 LE (Login Lateness)</td></tr>
  <tr><td>No Show No Call (NSNC)</td><td>3 Days</td></tr>
  <tr><td>Leave without 2 Weeks Notice</td><td>2 Weeks penalty</td></tr>
  <tr><td>Day-Off not approved</td><td>3 Days</td></tr>
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
    content: `<div class="info-note">Deductions are doubled if the same agent appears more than once in the same month report.</div>
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
  <tr><td>No CC for HR Email</td><td colspan="3">Request rejected and multiplied by 3</td></tr>
  <tr><td>Arguing about instructions / Not following TL instructions</td><td>100 LE</td><td>150 LE</td><td>200 LE</td></tr>
  <tr><td>Dialer abuse</td><td>100 LE</td><td>200 LE</td><td>300 LE</td></tr>
  <tr><td>Changing Pause code for someone else</td><td>100 LE</td><td>200 LE</td><td>300 LE</td></tr>
  <tr><td>Wrong disposition / wrong pause code</td><td>50 LE</td><td>50 LE</td><td>50 LE</td></tr>
  <tr><td>Not closing dialer & shutting down PC after shift</td><td>100 LE</td><td>200 LE</td><td>300 LE</td></tr>
  <tr><td>Shuffling / Skipping calls (Wasting time)</td><td>300 LE</td><td>400 LE</td><td>500 LE</td></tr>
  <tr><td>Disposition/Pause/Dead Call for long time</td><td>100 LE</td><td>200 LE</td><td>300 LE</td></tr>
  <tr><td>Using WC for something else</td><td>50 LE</td><td>100 LE</td><td>200 LE</td></tr>
  <tr><td>Using WC right after break without approval</td><td>50 LE</td><td>100 LE</td><td>200 LE</td></tr>
  <tr><td>IT Technical pause without informing IT & RTM</td><td>50 LE</td><td>75 LE</td><td>100 LE</td></tr>
  <tr><td>Working from Home without IT Approval</td><td>100 LE</td><td>150 LE</td><td>200 LE</td></tr>
  <tr><td>Private windows (Streaming / Social media / Books)</td><td>50 LE</td><td>100 LE</td><td>150 LE</td></tr>
  <tr><td>Smoking in non-smoking areas</td><td>100 LE</td><td>250 LE</td><td>500 LE</td></tr>
  <tr><td>Leaving more than 5 people or using the elevator</td><td>100 LE</td><td>250 LE</td><td>350 LE</td></tr>
  <tr><td>Messing with AC</td><td>150 LE</td><td>200 LE</td><td>250 LE</td></tr>
  <tr><td>Using Cell Phone</td><td>100 LE</td><td>150 LE</td><td>200 LE</td></tr>
  <tr><td>Using normal non-sealed cup / Mug</td><td>100 LE</td><td>150 LE</td><td>200 LE</td></tr>
  <tr><td>Leaving floor without permission</td><td>100 LE</td><td>150 LE</td><td>200 LE</td></tr>
  <tr><td>Eating in the floor</td><td>100 LE</td><td>150 LE</td><td>200 LE</td></tr>
  <tr><td>Eating in the Training Room</td><td>100 LE</td><td>150 LE</td><td>200 LE</td></tr>
  <tr><td>Leaving floor while someone else is out</td><td>25 LE</td><td>50 LE</td><td>100 LE</td></tr>
  <tr><td>Transparent / revealing clothes, crop tops, ripped jeans, slippers/flipflops</td><td>150 LE</td><td>250 LE</td><td>350 LE</td></tr>
  <tr><td>Coffee/food spill left on stove</td><td>100 LE</td><td>100 LE</td><td>100 LE</td></tr>
  <tr><td>UnCleanliness</td><td>250 LE</td><td>300 LE</td><td>350 LE</td></tr>
  <tr><td>Standing on stairs / Out of company</td><td>100 LE</td><td>100 LE</td><td>100 LE</td></tr>
  <tr><td>Smoking on stairs</td><td>100 LE</td><td>100 LE</td><td>100 LE</td></tr>
  </tbody>
</table>
<div class="info-note">Not Working Day = unpaid day (Holiday, Day-Off, Technical).</div>`,
  },
  {
    sectionKey: "quality",
    title: "Quality & Fatal Mistakes",
    sortOrder: 30,
    content: `<table class="rules-table">
  <thead><tr><th>Violation</th><th>1st Time</th><th>2nd Time</th><th>3rd Time</th></tr></thead>
  <tbody>
  <tr><td>Attitude</td><td>250 LE</td><td>500 LE</td><td>Termination</td></tr>
  <tr><td>Misuse chairs/couches/tables/stations</td><td>250 LE</td><td>300 LE</td><td>350 LE</td></tr>
  <tr><td>Downloading software/app without IT/RTM permission</td><td>100 LE</td><td>200 LE</td><td>300 LE</td></tr>
  <tr><td>Spreading negativity</td><td>150 LE</td><td>250 LE</td><td>500 LE</td></tr>
  <tr><td>Arguing about applied deduction</td><td>150 LE</td><td>250 LE</td><td>500 LE</td></tr>
  <tr><td>Submitting Sale for someone else</td><td>500 LE</td><td>750 LE</td><td>Termination</td></tr>
  <tr><td>Religious / Political / Sexual talks/discussions</td><td>100 LE</td><td>500 LE</td><td>Termination</td></tr>
  <tr><td>Leaking company information</td><td>400 LE</td><td>600 LE</td><td>Termination</td></tr>
  <tr><td>Transferring lead without checking DNC</td><td>500 LE</td><td>1000 LE</td><td>Termination</td></tr>
  <tr><td>Not submitting 3 forms</td><td>100 LE</td><td>150 LE</td><td>200 LE</td></tr>
  <tr><td>Mislead PT: false info / wrong description</td><td>250 LE</td><td>350 LE</td><td>500 LE</td></tr>
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
  <li>Any absence or lateness, even if TL-approved, is multiplied by 3.</li>
  <li>All pause requests must be submitted on Friday.</li>
  <li>The pause period is calculated from the following Monday to Friday regardless of weeks requested.</li>
  <li>You are automatically on an action plan during the two-week notice.</li>
  <li>You must achieve 10 passed sales in two weeks.</li>
  <li>You must achieve at least 5 passed sales to guarantee 50% of the 2-week payment.</li>
  <li>Failing the minimum leads to cancellation of the 2-week payment.</li>
  <li>10 days of salary are withheld during the pause; it is returned after completing 10 working days on return.</li>
  <li>You may withdraw your notice at any time during the two weeks.</li>
</ul>`,
  },
  {
    sectionKey: "pausing",
    title: "Pausing Rules",
    sortOrder: 50,
    content: `<ul>
  <li>25 LE deducted per 15 mins after 3:00 PM, in addition to the 25 LE for fingerprint after 2:45.</li>
  <li>Allowance times are changeable by management and updated weekly on the dashboard.</li>
  <li>Deductions are subject to change by upper management.</li>
  <li>Allowance: 10+ mins (10–15), 15+ mins (15–20), 20+ mins.</li>
</ul>`,
  },
  {
    sectionKey: "additional_policies",
    title: "Additional Policies",
    sortOrder: 60,
    content: `<ul>
  <li><strong>Smoking:</strong> Allowed in the balcony only.</li>
  <li><strong>Elevator:</strong> Maximum 5 people at once.</li>
  <li><strong>Door policy (Makram site):</strong> You are not allowed to step outside if 5+ people are already outside.</li>
  <li><strong>Attitude violations</strong> are only applied by HR after investigation.</li>
</ul>`,
  },
];

async function seed() {
  const db = getSupabaseAdmin();

  for (const company of COMPANIES) {
    for (const section of SECTIONS) {
      const row = {
        company,
        section_key: section.sectionKey,
        title: section.title,
        content: section.content,
        sort_order: section.sortOrder,
        updated_by: "seed-script",
        updated_at: new Date().toISOString(),
      };

      const { error } = await db.from("rules_content").upsert(row, { onConflict: "company, section_key" });
      if (error) {
        throw new Error(`${company}/${section.sectionKey}: ${error.message}`);
      }
      console.log(`Seeded ${company}/${section.sectionKey}`);
    }
  }

  console.log("Rules content seeded successfully.");
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
