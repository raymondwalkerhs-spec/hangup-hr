/**
 * Data backend — Supabase only (production).
 * Google Sheets is deprecated; see LEGACY_GOOGLE_SHEETS.md.
 */
function getBackendName() {
  return String(process.env.DATA_BACKEND || "supabase").toLowerCase();
}

function useSupabase() {
  const name = getBackendName();
  if (name === "sheets") {
    throw new Error(
      "DATA_BACKEND=sheets is no longer supported. Set DATA_BACKEND=supabase in .env. See LEGACY_GOOGLE_SHEETS.md."
    );
  }
  return name === "supabase";
}

function getBackend() {
  useSupabase();
  return require("./supabase-repo");
}

module.exports = {
  getBackendName,
  useSupabase,
  getBackend,
};
