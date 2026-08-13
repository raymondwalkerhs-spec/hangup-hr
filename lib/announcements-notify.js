const { getSupabaseAdmin } = require("./supabase-client");
const { useSupabase } = require("./backend");
const store = require("./data-store");
const companyContext = require("./company-context");
const roles = require("./roles");
const audience = require("./announcements-audience");
const notifyStore = require("./notify-store");

function plainText(html, max = 180) {
  const t = String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function userInAnnouncementCompany(emp, company, userRole = null) {
  if (emp) return companyContext.filterEmployeesByCompany([emp], company).length > 0;
  const native = companyContext.getCompanyForUser(userRole);
  if (company === "hs2") {
    return native === "hs2" || roles.canAccessHs2CompanyContext(userRole);
  }
  return native !== "hs2";
}

async function resolveRecipientUsernames(announcement, { excludeUsername } = {}) {
  if (!useSupabase() || !announcement) return [];
  const company = announcement.company === "hs2" ? "hs2" : "hangup";
  const skip = String(excludeUsername || "").trim().toLowerCase();
  const { data, error } = await getSupabaseAdmin()
    .from("app_users")
    .select("username, role, status, employee_id, is_it")
    .eq("status", "active");
  if (error) throw new Error(error.message);

  let orgTeams = [];
  try {
    orgTeams = await require("./hrms-repo").readOrgTeams();
  } catch {
    orgTeams = [];
  }
  const employees = store.getEmployees({ hideOut: false }) || [];
  const empById = new Map(employees.map((e) => [e.id, e]));
  const out = [];

  for (const u of data || []) {
    const username = String(u.username || "").trim().toLowerCase();
    if (!username || username === skip) continue;
    const userRole = roles.enrichUserRole(
      roles.resolveUserRole(username, u.role),
      employees,
      u,
      orgTeams
    );
    const emp =
      (u.employee_id && empById.get(u.employee_id)) ||
      (userRole.employeeId && empById.get(userRole.employeeId)) ||
      null;
    if (!userInAnnouncementCompany(emp, company, userRole)) continue;
    if (!audience.canViewAnnouncement(announcement, userRole, { isEditor: false })) continue;
    out.push(username);
  }
  return [...new Set(out)];
}

async function notifyAnnouncementPublished(announcement, { actor } = {}) {
  if (!announcement?.id) return [];
  const usernames = await resolveRecipientUsernames(announcement, { excludeUsername: actor });
  if (!usernames.length) return [];
  const excerpt = plainText(announcement.bodyHtml);
  const scope = announcement.audienceSummary && announcement.audienceSummary !== "Whole company"
    ? ` · ${announcement.audienceSummary}`
    : "";
  return notifyStore.createNotificationsForUsers(usernames, {
    company: announcement.company === "hs2" ? "hs2" : "hangup",
    type: "announcement",
    title: announcement.title || "New announcement",
    body: `${excerpt || "Open Announcements to read."}${scope}`,
    entityType: "announcement",
    entityId: announcement.id,
  });
}

module.exports = {
  plainText,
  userInAnnouncementCompany,
  resolveRecipientUsernames,
  notifyAnnouncementPublished,
};
