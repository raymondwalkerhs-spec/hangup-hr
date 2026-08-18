const express = require("express");
const router = express.Router();
const roles = require("../lib/roles");
const announcementsRepo = require("../lib/announcements-repo");
const audienceLib = require("../lib/announcements-audience");
const announcementReads = require("../lib/announcements-reads");
const announcementNotify = require("../lib/announcements-notify");
const storage = require("../lib/storage");
const store = require("../lib/data-store");
const companyContext = require("../lib/company-context");
const { MANAGEABLE_ROLES } = require("../lib/permission-catalog");
const { parseCompany } = require("../lib/request-company-guard");

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_AUDIO_BYTES = 35 * 1024 * 1024;

function companyOf(req) {
  return parseCompany(req) === "hs2" ? "hs2" : "hangup";
}

function decodeBase64(contentBase64) {
  const raw = String(contentBase64 || "").replace(/^data:[^;]+;base64,/, "");
  return Buffer.from(raw, "base64");
}

function isEditor(req) {
  return roles.canEditAnnouncements(req.userRole);
}

function canSee(req, ann) {
  return audienceLib.canViewAnnouncement(ann, req.userRole, { isEditor: isEditor(req) });
}

function audiencePayload(body, { required = false } = {}) {
  const has =
    body?.companyWide !== undefined ||
    body?.audienceType !== undefined ||
    body?.audienceUnits !== undefined ||
    body?.audienceTeams !== undefined ||
    body?.audienceRoles !== undefined;
  if (!has && !required) return {};
  const companyWide = body?.companyWide === true || body?.audienceType === "company";
  if (companyWide) {
    return { audienceUnits: [], audienceTeams: [], audienceRoles: [] };
  }
  return {
    audienceUnits: audienceLib.normalizeList(body?.audienceUnits),
    audienceTeams: audienceLib.normalizeList(body?.audienceTeams),
    audienceRoles: audienceLib.normalizeRoles(body?.audienceRoles),
  };
}

async function scopedAudiencePayload(body, company, opts = {}) {
  const base = audiencePayload(body, opts);
  if (!Object.keys(base).length) return {};
  return audienceLib.filterAudienceToCompany(base, company);
}

router.get("/", async (req, res) => {
  if (!roles.canViewAnnouncements(req.userRole)) return res.status(403).json({ error: "Access denied" });
  try {
    const items = (await announcementsRepo.listAnnouncements(companyOf(req))).filter((ann) => canSee(req, ann));
    const announcements = await announcementReads.attachUnread(items, req.username);
    res.json({ announcements });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/unread-count", async (req, res) => {
  if (!roles.canViewAnnouncements(req.userRole)) return res.status(403).json({ error: "Access denied" });
  try {
    const items = (await announcementsRepo.listAnnouncements(companyOf(req))).filter((ann) => canSee(req, ann));
    const unreadCount = await announcementReads.unreadCountFor(items, req.username);
    res.json({ unreadCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/options", async (req, res) => {
  if (!roles.canEditAnnouncements(req.userRole)) return res.status(403).json({ error: "Access denied" });
  try {
    const company = companyOf(req);
    let employees = store.getEmployees({ hideOut: true }) || [];
    employees = companyContext.filterEmployeesByCompany(employees, company);
    const units = [...new Set(employees.map((e) => e.unit).filter(Boolean))].sort();
    const teams = [...new Set(employees.map((e) => e.team).filter(Boolean))];
    try {
      const hrmsRepo = require("../lib/hrms-repo");
      const orgTeams = await hrmsRepo.readOrgTeams();
      for (const t of orgTeams || []) {
        const name = String(t?.name || t?.team || "").trim();
        if (!name) continue;
        const unit = String(t?.unit || "").trim();
        if (!unit) continue;
        const hs2 = companyContext.getCompanyForUnit(unit) === "hs2";
        if (company === "hs2" ? hs2 : !hs2) teams.push(name);
      }
    } catch {
      /* org teams optional */
    }
    res.json({
      units: [...new Set(units)].sort(),
      teams: [...new Set(teams)].sort(),
      roles: MANAGEABLE_ROLES.map((id) => ({ id, label: audienceLib.ROLE_LABELS[id] || id })),
      imagePlacements: [
        { id: "top", label: "Above the text" },
        { id: "middle", label: "In the middle of the text" },
        { id: "bottom", label: "Below the text" },
      ],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/read", async (req, res) => {
  if (!roles.canViewAnnouncements(req.userRole)) return res.status(403).json({ error: "Access denied" });
  try {
    const row = await announcementsRepo.getAnnouncement(req.params.id);
    if (!row || row.company !== companyOf(req) || !canSee(req, row)) return res.status(404).json({ error: "Not found" });
    await announcementReads.markAnnouncementRead(req.username, row.id);
    res.json({ ok: true, unread: false });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/:id/image", async (req, res) => {
  if (!roles.canViewAnnouncements(req.userRole)) return res.status(403).json({ error: "Access denied" });
  try {
    const row = await announcementsRepo.getAnnouncement(req.params.id);
    if (!row || row.company !== companyOf(req) || !canSee(req, row)) return res.status(404).json({ error: "Not found" });
    if (!row.imagePath) return res.status(404).json({ error: "No image" });
    const { stream, mimeType } = await storage.getStorageFileStream(row.imagePath);
    res.setHeader("Content-Type", mimeType || "image/jpeg");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(row.imageName || "image")}"`);
    stream.pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id/audio", async (req, res) => {
  if (!roles.canViewAnnouncements(req.userRole)) return res.status(403).json({ error: "Access denied" });
  try {
    const row = await announcementsRepo.getAnnouncement(req.params.id);
    if (!row || row.company !== companyOf(req) || !canSee(req, row)) return res.status(404).json({ error: "Not found" });
    if (!row.audioPath) return res.status(404).json({ error: "No audio" });
    const { stream, mimeType } = await storage.getStorageFileStream(row.audioPath);
    res.setHeader("Content-Type", mimeType || "audio/mpeg");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(row.audioName || "audio")}"`);
    stream.pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  if (!roles.canViewAnnouncements(req.userRole)) return res.status(403).json({ error: "Access denied" });
  try {
    const row = await announcementsRepo.getAnnouncement(req.params.id);
    if (!row || row.company !== companyOf(req) || !canSee(req, row)) return res.status(404).json({ error: "Not found" });
    res.json({ announcement: announcementsRepo.publicAnnouncement(row) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  if (!roles.canEditAnnouncements(req.userRole)) return res.status(403).json({ error: "Access denied" });
  try {
    const announcement = await announcementsRepo.createAnnouncement(
      {
        company: companyOf(req),
        title: req.body?.title,
        bodyHtml: req.body?.bodyHtml,
        imagePlacement: req.body?.imagePlacement,
        ...await scopedAudiencePayload(req.body, companyOf(req), { required: true }),
      },
      req.username || ""
    );
    try {
      if (req.username) await announcementReads.markAnnouncementRead(req.username, announcement.id);
      await announcementNotify.notifyAnnouncementPublished(announcement, { actor: req.username });
    } catch (err) {
      console.warn("announcement notify failed:", err.message);
    }
    res.json({ announcement: announcementsRepo.publicAnnouncement(announcement) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch("/:id", async (req, res) => {
  if (!roles.canEditAnnouncements(req.userRole)) return res.status(403).json({ error: "Access denied" });
  try {
    const existing = await announcementsRepo.getAnnouncement(req.params.id);
    if (!existing || existing.company !== companyOf(req)) return res.status(404).json({ error: "Not found" });
    const announcement = await announcementsRepo.updateAnnouncement(
      req.params.id,
      {
        title: req.body?.title,
        bodyHtml: req.body?.bodyHtml,
        imagePlacement: req.body?.imagePlacement,
        ...await scopedAudiencePayload(req.body, companyOf(req)),
      },
      req.username || ""
    );
    res.json({ announcement: announcementsRepo.publicAnnouncement(announcement) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  if (!roles.canEditAnnouncements(req.userRole)) return res.status(403).json({ error: "Access denied" });
  try {
    const existing = await announcementsRepo.getAnnouncement(req.params.id);
    if (!existing || existing.company !== companyOf(req)) return res.status(404).json({ error: "Not found" });
    await announcementsRepo.deleteAnnouncement(req.params.id, req.username);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

async function handleMediaUpload(req, res, kind) {
  if (!roles.canEditAnnouncements(req.userRole)) return res.status(403).json({ error: "Access denied" });
  try {
    const existing = await announcementsRepo.getAnnouncement(req.params.id);
    if (!existing || existing.company !== companyOf(req)) return res.status(404).json({ error: "Not found" });
    const { readUploadBuffer } = require("../lib/read-upload-buffer");
    const parsed = await readUploadBuffer(req);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const fileName = String(parsed.fileName || (kind === "image" ? "image.jpg" : "audio.mp3"));
    const buffer = parsed.buffer;
    if (!buffer?.length) return res.status(400).json({ error: "File is required" });
    const max = kind === "image" ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES;
    if (buffer.length > max) {
      return res.status(400).json({ error: `File too large (max ${Math.round(max / (1024 * 1024))} MB)` });
    }
    const announcement = await announcementsRepo.uploadAnnouncementMedia(
      req.params.id,
      kind,
      { fileName, buffer, mimeType: storage.guessMime(fileName) },
      req.username || ""
    );
    res.json({ announcement });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

router.post("/:id/image", (req, res) => handleMediaUpload(req, res, "image"));
router.post("/:id/audio", (req, res) => handleMediaUpload(req, res, "audio"));

router.delete("/:id/image", async (req, res) => {
  if (!roles.canEditAnnouncements(req.userRole)) return res.status(403).json({ error: "Access denied" });
  try {
    const existing = await announcementsRepo.getAnnouncement(req.params.id);
    if (!existing || existing.company !== companyOf(req)) return res.status(404).json({ error: "Not found" });
    const announcement = await announcementsRepo.clearAnnouncementMedia(req.params.id, "image", req.username || "");
    res.json({ announcement });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/:id/audio", async (req, res) => {
  if (!roles.canEditAnnouncements(req.userRole)) return res.status(403).json({ error: "Access denied" });
  try {
    const existing = await announcementsRepo.getAnnouncement(req.params.id);
    if (!existing || existing.company !== companyOf(req)) return res.status(404).json({ error: "Not found" });
    const announcement = await announcementsRepo.clearAnnouncementMedia(req.params.id, "audio", req.username || "");
    res.json({ announcement });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
