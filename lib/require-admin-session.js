const { getSession, validateSession } = require("./session-store");
const roles = require("./roles");

function sessionFromRequest(req) {
  const id = req.headers["x-session-id"] || req.session?.appSessionId;
  if (!id) return null;
  return getSession(id);
}

function requireAdminSession(req, res, next) {
  const run = async () => {
    const session = sessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ error: "Not logged in" });
    }
    const valid = await validateSession(session.id);
    if (!valid) {
      return res.status(401).json({ error: "Session expired or revoked", sessionRevoked: true });
    }
    const role = roles.normalizeRole(valid.role);
    if (!["admin", "ceo"].includes(role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    req.appSession = valid;
    req.username = valid.username;
    req.userRole = { role, username: valid.username };
    next();
  };
  run().catch((err) => {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  });
}

module.exports = { requireAdminSession };
