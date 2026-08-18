const express = require("express");
const router = express.Router();
const roles = require("../lib/roles");
const store = require("../lib/data-store");
const companyContext = require("../lib/company-context");
const coachingRepo = require("../lib/coaching-repo");
const coachingScope = require("../lib/coaching-scope");
const { parseCompany } = require("../lib/request-company-guard");
const { isOutStatus } = require("../lib/employee-status");
const { egyptDateTimeLocal } = require("../lib/egypt-datetime");

function companyOf(req) {
  return parseCompany(req) === "hs2" ? "hs2" : "hangup";
}

async function companyEmployees(req, { hideOut = false } = {}) {
  let employees = store.getEmployees({ hideOut });
  const company = parseCompany(req);
  if (company) employees = companyContext.filterEmployeesByCompany(employees, company);
  try {
    const employeeAppRole = require("../lib/employee-app-role");
    let appUsers = [];
    try {
      appUsers = await require("../lib/users-admin").listAppUsers();
    } catch {
      appUsers = [];
    }
    employees = employeeAppRole.enrichEmployeesWithAppRole(employees, appUsers);
  } catch {
    /* optional */
  }
  return employees;
}

async function orgTeams() {
  return roles.loadOrgTeamsForScope();
}

function empName(emp) {
  if (!emp) return "";
  return emp.american_name || emp.arabic_name || emp.id || "";
}

function findEmp(employees, id) {
  if (!id) return null;
  return employees.find((e) => e.id === id) || null;
}

function isTicketAuthor(row, userRole) {
  const username = String(userRole?.username || "").toLowerCase();
  if (username && String(row.created_by || "").toLowerCase() === username) return true;
  if (userRole?.employeeId && row.author_employee_id && row.author_employee_id === userRole.employeeId) {
    return true;
  }
  return false;
}

function isTicketCoach(row, userRole) {
  const id = userRole?.employeeId || "";
  return Boolean(id && row.coach_employee_id && row.coach_employee_id === id);
}

function includeSecret(row, userRole) {
  if (roles.canViewCoachingSecret(userRole)) return true;
  if (isTicketCoach(row, userRole) || isTicketAuthor(row, userRole)) return true;
  return false;
}

function canSeeAllCompanyCoaching(userRole) {
  const role = roles.normalizeRole(userRole?.role);
  return ["hr", "admin", "ceo", "quality"].includes(role);
}

function canManageNotes(userRole) {
  return ["hr", "admin", "ceo"].includes(roles.normalizeRole(userRole?.role));
}

function present(row, userRole, employees = []) {
  const mapped = coachingRepo.mapRow(row, { includeSecret: includeSecret(row, userRole) });
  const agent = findEmp(employees, row.employee_id);
  const coach = findEmp(employees, row.coach_employee_id);
  mapped.agentName = empName(agent) || row.employee_id;
  mapped.agentStatus = agent?.status || "";
  mapped.coachName = empName(coach) || row.coach_employee_id || "";
  mapped.team = mapped.team || agent?.team || "";
  mapped.unit = mapped.unit || agent?.unit || "";
  return mapped;
}

function visibleTickets(rows, req, employees, teams) {
  const ownId = req.userRole?.employeeId || "";
  if (canSeeAllCompanyCoaching(req.userRole)) return rows;
  const role = roles.normalizeRole(req.userRole?.role);
  if (role === "op" || roles.hasLeadTeamAssignment(req.userRole) || roles.hasCloserTeamAssignment(req.userRole) || role === "tl") {
    const allowedAgents = new Set(
      coachingScope.employeesForCoachingAgent(req.userRole, employees, { orgTeams: teams }).map((e) => e.id)
    );
    return rows.filter(
      (r) =>
        allowedAgents.has(r.employee_id) ||
        isTicketAuthor(r, req.userRole) ||
        isTicketCoach(r, req.userRole) ||
        (ownId && r.employee_id === ownId)
    );
  }
  if (!ownId) return [];
  return rows.filter((r) => r.employee_id === ownId || r.coach_employee_id === ownId);
}

function applyListFilters(rows, query, employees) {
  let out = rows;
  const dateFrom = String(query.dateFrom || "").slice(0, 10);
  const dateTo = String(query.dateTo || "").slice(0, 10);
  if (dateFrom) out = out.filter((r) => String(r.coaching_date || r.coaching_at || "").slice(0, 10) >= dateFrom);
  if (dateTo) out = out.filter((r) => String(r.coaching_date || r.coaching_at || "").slice(0, 10) <= dateTo);
  if (query.agent) {
    const ids = String(query.agent).split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length) out = out.filter((r) => ids.includes(r.employee_id));
  }
  if (query.coach) {
    const ids = String(query.coach).split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length) out = out.filter((r) => ids.includes(r.coach_employee_id));
  }
  if (query.outcome) {
    const wanted = String(query.outcome).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (wanted.length) out = out.filter((r) => wanted.includes(String(r.outcome || "pending").toLowerCase()));
  }
  if (query.team) {
    const teams = String(query.team).split(",").map((s) => s.trim()).filter(Boolean);
    if (teams.length) {
      out = out.filter((r) => {
        const emp = findEmp(employees, r.employee_id);
        const team = r.team || emp?.team || "";
        return teams.includes(team);
      });
    }
  }
  if (query.agentStatus === "active" || query.agentStatus === "out") {
    out = out.filter((r) => {
      const emp = findEmp(employees, r.employee_id);
      const outStatus = emp ? isOutStatus(emp.status) : false;
      return query.agentStatus === "out" ? outStatus : !outStatus;
    });
  }
  return out;
}

router.get("/options", async (req, res) => {
  if (!roles.canViewCoaching(req.userRole) && !roles.canSubmitCoaching(req.userRole)) {
    return res.status(403).json({ error: "Access denied" });
  }
  try {
    const teams = await orgTeams();
    const employees = await companyEmployees(req, { hideOut: false });
    const agents = coachingScope.employeesForCoachingAgent(req.userRole, employees, { orgTeams: teams }).map((e) =>
      coachingScope.presentEmp(e)
    );
    const coaches = coachingScope.coachesForUser(req.userRole, employees, { orgTeams: teams });
    res.json({
      agents,
      coaches: {
        tls: (coaches.tls || []).map((e) => coachingScope.presentEmp(e)),
        closers: (coaches.closers || []).map((e) => coachingScope.presentEmp(e)),
        ops: (coaches.ops || []).map((e) => coachingScope.presentEmp(e)),
        quality: (coaches.quality || []).map((e) => coachingScope.presentEmp(e)),
        agents: (coaches.agents || []).map((e) => coachingScope.presentEmp(e)),
      },
      defaultCoachId: coaches.defaultCoachId || "",
      canAssignCoach: coaches.canAssignCoach === true,
      coachLocked: coaches.coachLocked === true,
      canEditDateTime: roles.canEditCoachingDateTime(req.userRole),
      canDelete: roles.canDeleteCoaching(req.userRole),
      canViewSecret: roles.canViewCoachingSecret(req.userRole),
      outcomes: coachingScope.COACHING_OUTCOMES,
      nowLocal: egyptDateTimeLocal(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/scoped-agents", async (req, res) => {
  if (!roles.canSubmitCoaching(req.userRole) && !roles.canViewCoaching(req.userRole)) {
    return res.status(403).json({ error: "Access denied" });
  }
  try {
    const teams = await orgTeams();
    const employees = await companyEmployees(req, { hideOut: false });
    const agents = coachingScope.employeesForCoachingAgent(req.userRole, employees, { orgTeams: teams });
    res.json({ employees: agents.map((e) => coachingScope.presentEmp(e)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/", async (req, res) => {
  if (!roles.canViewCoaching(req.userRole)) return res.status(403).json({ error: "Access denied" });
  try {
    const company = companyOf(req);
    const teams = await orgTeams();
    const employees = await companyEmployees(req, { hideOut: false });
    let rows = await coachingRepo.listCoachingTickets({ company });
    rows = visibleTickets(rows, req, employees, teams);
    rows = applyListFilters(rows, req.query || {}, employees);
    const presented = rows.map((r) => present(r, req.userRole, employees));
    const agentIds = new Set(presented.map((t) => t.employeeId).filter(Boolean));
    const coachIds = new Set(presented.map((t) => t.coachEmployeeId).filter(Boolean));
    const teamNames = new Set(presented.map((t) => t.team).filter(Boolean));
    res.json({
      tickets: presented,
      filterOptions: {
        agents: [...agentIds].map((id) => ({ id, name: empName(findEmp(employees, id)) || id })),
        coaches: [...coachIds].map((id) => ({ id, name: empName(findEmp(employees, id)) || id })),
        teams: [...teamNames].sort(),
        outcomes: coachingScope.COACHING_OUTCOMES,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  if (!roles.canViewCoaching(req.userRole)) return res.status(403).json({ error: "Access denied" });
  try {
    const row = await coachingRepo.getCoachingTicket(req.params.id);
    if (!row || row.company !== companyOf(req)) return res.status(404).json({ error: "Not found" });
    const teams = await orgTeams();
    const employees = await companyEmployees(req, { hideOut: false });
    const allowed = visibleTickets([row], req, employees, teams).length > 0;
    if (!allowed) return res.status(403).json({ error: "Access denied" });
    res.json({ ticket: present(row, req.userRole, employees) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  if (!roles.canSubmitCoaching(req.userRole)) return res.status(403).json({ error: "Access denied" });
  try {
    const teams = await orgTeams();
    const employees = await companyEmployees(req, { hideOut: false });
    const employeeId = String(req.body?.employeeId || "").trim();
    if (!coachingScope.isAllowedCoachee(req.userRole, employeeId, employees, teams)) {
      return res.status(400).json({ error: "Agent is not in your coaching scope (active agents only; HR / Quality / Admin cannot be coached)" });
    }
    const emp = findEmp(employees, employeeId);
    const coaches = coachingScope.coachesForUser(req.userRole, employees, { orgTeams: teams });
    let coachId = String(req.body?.coachEmployeeId || "").trim();
    if (coaches.coachLocked || !coaches.canAssignCoach) {
      coachId = req.userRole?.employeeId || coachId;
    } else if (!coachId) {
      coachId = coaches.defaultCoachId || "";
    }
    if (!coachingScope.isAllowedCoach(req.userRole, coachId, employees, teams)) {
      return res.status(400).json({ error: "Coach is not in your assignment scope" });
    }
    const canWriteSecret =
      roles.canViewCoachingSecret(req.userRole) ||
      isTicketAuthor({ created_by: req.username, author_employee_id: req.userRole?.employeeId }, req.userRole);
    const row = await coachingRepo.createCoachingTicket(
      {
        company: companyOf(req),
        employeeId,
        coachEmployeeId: coachId,
        submittedBy: req.username || "",
        coachingAt: roles.canEditCoachingDateTime(req.userRole) ? req.body?.coachingAt : undefined,
        coachingDate: roles.canEditCoachingDateTime(req.userRole) ? req.body?.coachingDate : undefined,
        outcome: req.body?.outcome,
        generalNotes: req.body?.generalNotes,
        secretNotes: canWriteSecret ? req.body?.secretNotes : "",
        authorEmployeeId: req.userRole?.employeeId || "",
        authorRole: roles.normalizeRole(req.userRole?.role),
        unit: emp?.unit || "",
        team: emp?.team || "",
      },
      req.username || ""
    );
    res.json({ ticket: present(row, req.userRole, employees) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch("/:id", async (req, res) => {
  if (!roles.canViewCoaching(req.userRole) && !roles.canSubmitCoaching(req.userRole)) {
    return res.status(403).json({ error: "Access denied" });
  }
  try {
    const existing = await coachingRepo.getCoachingTicket(req.params.id);
    if (!existing || existing.company !== companyOf(req)) return res.status(404).json({ error: "Not found" });
    const teams = await orgTeams();
    const employees = await companyEmployees(req, { hideOut: false });
    const coach = isTicketCoach(existing, req.userRole);
    const author = isTicketAuthor(existing, req.userRole);
    const admin = roles.canDeleteCoaching(req.userRole);
    const hr = canManageNotes(req.userRole);
    if (!coach && !author && !admin && !hr && !roles.canViewCoachingSecret(req.userRole)) {
      return res.status(403).json({ error: "Access denied" });
    }

    const patch = {};
    if (req.body?.outcome !== undefined) {
      if (!(coach || admin || hr)) return res.status(403).json({ error: "Only the coach can update outcome" });
      patch.outcome = req.body.outcome;
    }
    if (req.body?.extraGeneralNotes !== undefined) {
      if (!(coach || admin || hr)) return res.status(403).json({ error: "Cannot update extra notes" });
      patch.extraGeneralNotes = req.body.extraGeneralNotes;
    }
    if (req.body?.extraSecretNotes !== undefined) {
      if (!(coach || admin || hr)) {
        return res.status(403).json({ error: "Cannot update secret extra notes" });
      }
      patch.extraSecretNotes = req.body.extraSecretNotes;
    }
    if (req.body?.generalNotes !== undefined || req.body?.secretNotes !== undefined) {
      if (!(admin || hr)) return res.status(403).json({ error: "Original notes cannot be edited" });
      if (req.body.generalNotes !== undefined) patch.generalNotes = req.body.generalNotes;
      if (req.body.secretNotes !== undefined) patch.secretNotes = req.body.secretNotes;
    }
    if (req.body?.coachingAt !== undefined || req.body?.coachingDate !== undefined) {
      if (!roles.canEditCoachingDateTime(req.userRole)) {
        return res.status(403).json({ error: "Only Admin can edit coaching date and time" });
      }
      patch.coachingAt = req.body.coachingAt;
      patch.coachingDate = req.body.coachingDate;
    }
    if (req.body?.employeeId !== undefined || req.body?.coachEmployeeId !== undefined) {
      if (!admin) return res.status(403).json({ error: "Only Admin can reassign agent or coach" });
      if (req.body.employeeId !== undefined) {
        if (!coachingScope.isAllowedCoachee(req.userRole, req.body.employeeId, employees, teams)) {
          return res.status(400).json({ error: "Agent is not in your coaching scope" });
        }
        const emp = findEmp(employees, req.body.employeeId);
        patch.employeeId = emp.id;
        patch.unit = emp.unit || "";
        patch.team = emp.team || "";
      }
      if (req.body.coachEmployeeId !== undefined) {
        if (!coachingScope.isAllowedCoach(req.userRole, req.body.coachEmployeeId, employees, teams)) {
          return res.status(400).json({ error: "Coach is not in your assignment scope" });
        }
        patch.coachEmployeeId = req.body.coachEmployeeId;
      }
    }

    if (!Object.keys(patch).length) return res.json({ ticket: present(existing, req.userRole, employees) });
    const row = await coachingRepo.updateCoachingTicket(req.params.id, patch);
    res.json({ ticket: present(row, req.userRole, employees) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  if (!roles.canDeleteCoaching(req.userRole)) {
    return res.status(403).json({ error: "Only Admin can delete coaching tickets" });
  }
  try {
    const existing = await coachingRepo.getCoachingTicket(req.params.id);
    if (!existing || existing.company !== companyOf(req)) return res.status(404).json({ error: "Not found" });
    await coachingRepo.deleteCoachingTicket(req.params.id, req.username);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
