const STATUSES = {
  active: "Active",
  paused: "Paused",
  paused_still_paid: "Paused still get paid",
  out_still_paid: "OUT BUT STILL GET PAID",
  out: "Out",
  promoted: "Promoted",
};

const LEGACY_MAP = {
  active: "active",
  paused: "paused",
  "paused still get paid": "paused_still_paid",
  "paused still paid": "paused_still_paid",
  "out but still get paid": "out_still_paid",
  "out still paid": "out_still_paid",
  out: "out",
  promoted: "promoted",
  "": "active",
};

function normalizeStatusKey(status) {
  const raw = String(status || "").trim().toLowerCase();
  return LEGACY_MAP[raw] || (STATUSES[raw] ? raw : "active");
}

function statusDisplay(key) {
  const k = normalizeStatusKey(key);
  return STATUSES[k] || statusDisplay("active");
}

function isOutStatus(status) {
  const k = normalizeStatusKey(status);
  return k === "out" || k === "out_still_paid";
}

function isPayrollEligibleStatus(status) {
  const k = normalizeStatusKey(status);
  return ["active", "paused_still_paid", "out_still_paid", "paused"].includes(k);
}

function statusOptions() {
  return [
    { key: "active", label: "Active" },
    { key: "paused", label: "Paused" },
    { key: "paused_still_paid", label: "Paused still paid" },
    { key: "out_still_paid", label: "Out still paid" },
    { key: "out", label: "Out" },
  ];
}

module.exports = {
  STATUSES,
  normalizeStatusKey,
  statusDisplay,
  isOutStatus,
  isPayrollEligibleStatus,
  statusOptions,
};
