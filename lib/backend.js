/**
 * Data backend selector — Google Sheets (legacy) or Supabase (primary).
 */
function getBackendName() {
  return String(process.env.DATA_BACKEND || "sheets").toLowerCase();
}

function useSupabase() {
  return getBackendName() === "supabase";
}

function getBackend() {
  return useSupabase() ? require("./supabase-repo") : require("./sheets");
}

module.exports = {
  getBackendName,
  useSupabase,
  getBackend,
};
