const { getSupabaseAdmin } = require("./supabase-client");

async function fetchVersionPolicyFromSupabase() {
  const { data, error } = await getSupabaseAdmin()
    .from("app_versions")
    .select("*")
    .order("release_date", { ascending: true });
  if (error) throw error;
  if (!data?.length) return null;

  const entries = data.map((r) => ({
    version: r.version,
    releaseDate: r.release_date || "",
    releaseType: r.release_type || "minor",
    minCompatibleVersion: r.min_compatible_version || "",
    forceUpdateMinVersion: r.force_update_min_version || "",
    isCurrent: r.is_current === true,
    notes: r.notes || "",
  }));

  const current = entries.find((e) => e.isCurrent) || entries[entries.length - 1];
  const releaseType = current.releaseType || "minor";
  const minCompatibleVersion =
    current.minCompatibleVersion ||
    (releaseType === "major" ? current.version : entries[0]?.version || current.version);
  const forceUpdateMinVersion = current.forceUpdateMinVersion || null;

  return {
    currentVersion: current.version,
    minCompatibleVersion,
    forceUpdateMinVersion,
    releaseType,
    releaseDate: current.releaseDate,
    updateMessage: current.notes
      ? `A newer version (${current.version}) is available: ${current.notes}`
      : "",
    blockedMessage: current.notes
      ? `This app version is no longer supported. ${current.notes} Contact Admin for version ${current.version}.`
      : "",
    fieldBlockedMessage: forceUpdateMinVersion
      ? `This build is too old for HR and field staff. Install version ${forceUpdateMinVersion} or newer. ${current.notes || ""}`.trim()
      : "",
    entries,
  };
}

async function fetchVersionPolicy() {
  try {
    return await fetchVersionPolicyFromSupabase();
  } catch (err) {
    console.warn("Supabase version policy:", err.message);
    return null;
  }
}

module.exports = {
  fetchVersionPolicy,
};
