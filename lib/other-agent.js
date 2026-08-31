/**
 * Placeholder agent for sales submitted before a real agent is assigned.
 * Seeded as employees.id = 'OTHER' (keeps agent_id FK). Hidden from org,
 * attendance, payroll, and dialing lists — only the sale picker offers it.
 */
const OTHER_AGENT_ID = "OTHER";

function isOtherAgentId(id) {
  return String(id || "").trim().toUpperCase() === OTHER_AGENT_ID;
}

function excludeOtherAgents(list) {
  return (Array.isArray(list) ? list : []).filter((e) => !isOtherAgentId(e?.id || e));
}

module.exports = {
  OTHER_AGENT_ID,
  isOtherAgentId,
  excludeOtherAgents,
};
