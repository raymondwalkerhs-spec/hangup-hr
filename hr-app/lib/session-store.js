/** In-memory session only — no offline cache, no password persistence on disk */
const sessions = new Map();

function createSession(username, password) {
  const id = require("crypto").randomBytes(32).toString("hex");
  const session = {
    id,
    username,
    password,
    createdAt: Date.now(),
  };
  sessions.set(id, session);
  return session;
}

function getSession(id) {
  return sessions.get(id) || null;
}

function destroySession(id) {
  sessions.delete(id);
}

module.exports = { createSession, getSession, destroySession };
