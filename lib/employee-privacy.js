/**
 * Strip sensitive employee fields for role-scoped API responses.
 */
function isAgentRole(role) {
  return String(role || "").toLowerCase() === "agent";
}

function sanitizeEmployee(emp, role) {
  if (!emp || !isAgentRole(role)) return emp;
  const copy = { ...emp };
  delete copy.internal_id;
  return copy;
}

function sanitizeEmployees(list, role) {
  if (!Array.isArray(list) || !isAgentRole(role)) return list;
  return list.map((e) => sanitizeEmployee(e, role));
}

module.exports = {
  isAgentRole,
  sanitizeEmployee,
  sanitizeEmployees,
};
