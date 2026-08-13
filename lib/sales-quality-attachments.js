/**
 * Quality-ticket file kinds. Access Control may add roles, but quality / RTM /
 * admin / CEO / PR always keep view+upload on these kinds.
 */
function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

const QUALITY_TICKET_ATTACHMENT_KEYS = ["recording", "raw_call", "quality_record"];
const QUALITY_TICKET_ATTACHMENT_ROLES = ["quality", "rtm", "admin", "ceo", "public_relations"];

function isQualityTicketAttachmentKind(kind) {
  return QUALITY_TICKET_ATTACHMENT_KEYS.includes(String(kind || "").trim().toLowerCase());
}

function withQualityTicketAttachFloor(kindKey, rolesList, fallback) {
  const base = Array.isArray(rolesList) && rolesList.length ? rolesList : fallback || [];
  if (!isQualityTicketAttachmentKind(kindKey)) return base;
  const set = new Set(base.map(normalizeRole).filter(Boolean));
  for (const role of QUALITY_TICKET_ATTACHMENT_ROLES) set.add(role);
  return [...set];
}

module.exports = {
  QUALITY_TICKET_ATTACHMENT_KEYS,
  QUALITY_TICKET_ATTACHMENT_ROLES,
  isQualityTicketAttachmentKind,
  withQualityTicketAttachFloor,
};
