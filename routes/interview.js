const express = require("express");
const router = express.Router();
const roles = require("../lib/roles");
const companyContext = require("../lib/company-context");
const { useSupabase } = require("../lib/backend");
const supabaseRepo = require("../lib/supabase-repo");

const STATUS_OPTIONS = ["pending", "on hold", "accepted", "rejected"];
const TRAINING_OPTIONS = ["waiting", "on hold", "started", "dropped", "postponed", "cancelled"];
const GRADUATION_OPTIONS = ["Graduated", "Not Graduated", "In Progress"];
const TRAINER_OPTIONS = ["TL", "OP"];

const TRAINING_FEEDBACK_COLUMNS = ["Candidate Name", "Candidate Email", "Day", "Feedback Text", "Trainer", "Date", "Is Test Call Day", "Active Listening", "English", "Accent", "Product Knowledge"];

function requireInterviewAccess(req, res) {
  const role = req.userRole?.role;
  if (!["admin", "ceo", "hr", "op", "tl", "quality"].includes(role)) {
    return res.status(403).json({ error: "HR, Admin, Quality, or Trainer only" });
  }
}

function interviewCompany(req) {
  return companyContext.resolveCompanyContextForUser(req.query.company, req.userRole);
}

router.get("/interviews", async (req, res) => {
  requireInterviewAccess(req, res);
  if (res.headersSent) return;
  try {
    const company = interviewCompany(req);
    const rows = await supabaseRepo.readCandidateApplications(req.userRole, { company });
    const [interviewerOptions, trainerOptions] = await Promise.all([
      supabaseRepo.getInterviewerOptions(req.userRole),
      supabaseRepo.getTrainerOptions(req.userRole),
    ]);
    res.json({
      rows,
      headers: [],
      spreadsheetId: null,
      tab: null,
      role: req.userRole?.role,
      username: req.username,
      interviewerOptions,
      trainerOptions,
      statusOptions: STATUS_OPTIONS,
      trainingOptions: TRAINING_OPTIONS,
      graduationOptions: GRADUATION_OPTIONS,
      canEditInterview: roles.canEditInterview(req.userRole),
      canDeleteInterview: roles.canDeleteInterview(req.userRole),
    });
  } catch (err) {
    console.error("[interview] list error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/interviews", async (req, res) => {
  requireInterviewAccess(req, res);
  if (res.headersSent) return;
  try {
    const company = interviewCompany(req);
    const body = { ...(req.body || {}), company: company === "hs2" ? "hs2" : "hangup" };
    const row = await supabaseRepo.createCandidateApplication(body, req.username);
    await supabaseRepo.syncInterviewsToSheets();
    res.json({ ok: true, id: row.id });
  } catch (err) {
    console.error("[interview] create error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put("/interviews/:id", async (req, res) => {
  if (!roles.canEditInterview(req.userRole)) {
    return res.status(403).json({ error: "No permission to edit interviews" });
  }
  try {
    const id = req.params.id;
    const updates = req.body || {};
    const row = await supabaseRepo.updateCandidateApplication(id, updates, req.userRole);
    await supabaseRepo.syncInterviewsToSheets();
    res.json({ ok: true, id: row.id });
  } catch (err) {
    console.error("[interview] update error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/interviews/:id", async (req, res) => {
  if (!roles.canDeleteInterview(req.userRole)) {
    return res.status(403).json({ error: "No permission to delete interviews" });
  }
  try {
    const id = req.params.id;
    await supabaseRepo.deleteCandidateApplication(id, req.userRole);
    await supabaseRepo.syncInterviewsToSheets();
    res.json({ ok: true });
  } catch (err) {
    console.error("[interview] delete error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/interviews/meta", async (req, res) => {
  requireInterviewAccess(req, res);
  if (res.headersSent) return;
  try {
    const [interviewerOptions, trainerOptions] = await Promise.all([
      supabaseRepo.getInterviewerOptions(req.userRole),
      supabaseRepo.getTrainerOptions(req.userRole),
    ]);
    res.json({
      spreadsheetId: null,
      tab: null,
      headers: [],
      interviewerOptions,
      trainerOptions,
      statusOptions: STATUS_OPTIONS,
      trainingOptions: TRAINING_OPTIONS,
      graduationOptions: GRADUATION_OPTIONS,
      role: req.userRole?.role,
      username: req.username,
      canEditInterview: roles.canEditInterview(req.userRole),
      canDeleteInterview: roles.canDeleteInterview(req.userRole),
    });
  } catch (err) {
    console.error("[interview] meta error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/interviews/training", async (req, res) => {
  requireInterviewAccess(req, res);
  if (res.headersSent) return;
  try {
    const company = interviewCompany(req);
    const rows = await supabaseRepo.readCandidateApplications(req.userRole, { company });
    const trainerFilter = String(req.query.trainer || "").trim().toLowerCase();
    const dateFilter = String(req.query.trainingStartDate || "").trim().toLowerCase();
    const filtered = rows.filter((r) => {
      const status = String(r.trainingStatus || "").toLowerCase();
      if (status !== "started") return false;
      if (trainerFilter && String(r.trainer || "").toLowerCase() !== trainerFilter) return false;
      if (dateFilter && String(r.trainingStartDate || "").toLowerCase() !== dateFilter) return false;
      return true;
    });
    const rowsWithFeedbacks = await Promise.all(
      filtered.map(async (r) => {
        const feedbacks = await supabaseRepo.readInterviewFeedbacks(r.id, req.userRole);
        return { ...r, feedbacks };
      })
    );
    res.json({ rows: rowsWithFeedbacks });
  } catch (err) {
    console.error("[interview] training list error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/interviews/feedbacks", async (req, res) => {
  requireInterviewAccess(req, res);
  if (res.headersSent) return;
  try {
    const candidateId = req.query.candidateId || null;
    const rows = await supabaseRepo.readInterviewFeedbacks(candidateId, req.userRole);
    res.json({ rows, headers: TRAINING_FEEDBACK_COLUMNS });
  } catch (err) {
    console.error("[interview] feedbacks list error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/interviews/feedbacks", async (req, res) => {
  requireInterviewAccess(req, res);
  if (res.headersSent) return;
  try {
    const body = req.body || {};
    const role = req.userRole?.role;
    const username = String(req.username || "").trim().toLowerCase();
    const candidateId = body.candidateId || body.candidate_id;
    if (!candidateId) return res.status(400).json({ error: "candidateId required" });
    const candidate = await supabaseRepo.getCandidateApplication(candidateId, req.userRole);
    if (!candidate) return res.status(404).json({ error: "Candidate not found" });
    if (["op", "tl"].includes(role) && username) {
      const trainer = body.trainer || username;
      if (String(trainer).trim().toLowerCase() !== username) {
        return res.status(403).json({ error: "Trainers can only create feedback for themselves" });
      }
    }
    const row = await supabaseRepo.createInterviewFeedback({
      candidateId,
      candidateName: body.candidateName || body.candidate_name || candidate.name,
      candidateEmail: body.candidateEmail || body.candidate_email || candidate.email,
      day: body.day,
      feedbackText: body.feedbackText || body.feedback_text,
      trainer: body.trainer,
      date: body.date,
      company: candidate.company,
    });
    res.json({ ok: true, id: row.id });
  } catch (err) {
    console.error("[interview] feedbacks create error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put("/interviews/feedbacks/:id", async (req, res) => {
  requireInterviewAccess(req, res);
  if (res.headersSent) return;
  try {
    const id = req.params.id;
    const updates = req.body || {};
    const role = req.userRole?.role;
    const username = String(req.username || "").trim().toLowerCase();
    const current = await supabaseRepo.getInterviewFeedbackById(id, req.userRole);
    if (!current) return res.status(404).json({ error: "Feedback not found" });
    if (current.candidate_id) {
      const candidate = await supabaseRepo.getCandidateApplication(current.candidate_id, req.userRole);
      if (!candidate) return res.status(404).json({ error: "Candidate not found" });
    }
    if (["op", "tl"].includes(role) && username) {
      if (String(current.trainer || "").trim().toLowerCase() !== username) {
        return res.status(403).json({ error: "Trainers can only edit their own feedback" });
      }
    }
    const row = await supabaseRepo.updateInterviewFeedback(id, updates);
    res.json({ ok: true, id: row.id });
  } catch (err) {
    console.error("[interview] feedbacks update error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/interviews/feedbacks/:id", async (req, res) => {
  requireInterviewAccess(req, res);
  if (res.headersSent) return;
  try {
    const id = req.params.id;
    const role = req.userRole?.role;
    const username = String(req.username || "").trim().toLowerCase();
    const current = await supabaseRepo.getInterviewFeedbackById(id, req.userRole);
    if (!current) return res.status(404).json({ error: "Feedback not found" });
    if (current.candidate_id) {
      const candidate = await supabaseRepo.getCandidateApplication(current.candidate_id, req.userRole);
      if (!candidate) return res.status(404).json({ error: "Candidate not found" });
    }
    if (["op", "tl"].includes(role) && username) {
      if (String(current.trainer || "").trim().toLowerCase() !== username) {
        return res.status(403).json({ error: "Trainers can only delete their own feedback" });
      }
    }
    await supabaseRepo.deleteInterviewFeedback(id);
    res.json({ ok: true });
  } catch (err) {
    console.error("[interview] feedbacks delete error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
