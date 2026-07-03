const https = require("https");
const { useSupabase } = require("./backend");
const { isSupabaseConfigured, getSupabaseAdmin } = require("./supabase-client");

function probeUrl(url, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const req = https.get(url, (res) => {
      resolve(res.statusCode >= 200 && res.statusCode < 500);
      res.resume();
    });
    req.on("error", () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function isOnline() {
  const probes = [
    process.env.SUPABASE_URL,
    "https://www.google.com/generate_204",
    "https://www.gstatic.com/generate_204",
  ].filter(Boolean);
  for (const url of probes) {
    if (await probeUrl(url)) return true;
  }
  return false;
}

async function verifyBackendAccess() {
  useSupabase();
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured. Set SUPABASE_URL and keys in .env.");
  }
  const admin = getSupabaseAdmin();
  const query = admin.from("employees").select("id").limit(1);
  const { error } = await Promise.race([
    query,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Supabase query timed out")), 12000)
    ),
  ]);
  if (error) throw new Error(`Supabase: ${error.message}`);
  return {
    ok: true,
    backend: "supabase",
    url: process.env.SUPABASE_URL,
  };
}

/** @deprecated use verifyBackendAccess */
async function verifyGoogleSheetsAccess() {
  return verifyBackendAccess();
}

async function requireOnline() {
  if (await isOnline()) return true;

  try {
    await verifyBackendAccess();
    return true;
  } catch (err) {
    const detail = err.message || String(err);
    throw new Error(
      `Cannot reach Supabase (${detail}). Check your internet connection and .env keys.`
    );
  }
}

module.exports = {
  isOnline,
  requireOnline,
  verifyBackendAccess,
  verifyGoogleSheetsAccess,
  probeUrl,
};
