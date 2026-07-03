/**
 * Dropbox API for sales recordings and attachments.
 * Credentials via DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_ACCESS_TOKEN in .env
 */

const https = require("https");

function getAccessToken() {
  return process.env.DROPBOX_ACCESS_TOKEN || "";
}

function isConfigured() {
  return Boolean(getAccessToken());
}

function isScopeError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("missing_scope") || msg.includes("not permitted") || msg.includes("required scope");
}

/** Test write, read, and sharing scopes (call after regenerating token in App Console). */
async function verifyAccess() {
  const folder = process.env.DROPBOX_SALES_FOLDER || "/Hangup-HR/Sales";
  const probe = Buffer.from("hangup-hr-dropbox-probe");
  const probePath = `${folder}/.probe-${Date.now()}.txt`;
  const checks = { write: false, read: false, sharing: false };
  try {
    const uploaded = await contentUpload(probePath, probe, "probe.txt");
    checks.write = true;
    const path = uploaded.dropboxPath || probePath;
    await downloadFile(path);
    checks.read = true;
    const link = await createSharedLink(path, { allowExisting: true });
    if (!link) throw new Error("sharing.create_shared_link returned empty URL");
    checks.sharing = true;
    await apiRequest("/2/files/delete_v2", { body: { path: path.startsWith("/") ? path : `/${path}` } });
    return { ok: true, folder, checks, message: "write + read + sharing OK" };
  } catch (err) {
    const hint = isScopeError(err)
      ? "In Dropbox App Console: enable files.content.read + files.content.write + sharing.write, click Generate access token, paste the NEW token into DROPBOX_ACCESS_TOKEN in .env (old tokens do not pick up new scopes)."
      : "";
    return { ok: false, error: err.message, hint, checks };
  }
}

function apiRequest(path, options = {}) {
  const token = getAccessToken();
  if (!token) throw new Error("Dropbox not configured. Set DROPBOX_ACCESS_TOKEN in .env");

  const body = options.body ? JSON.stringify(options.body) : null;
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.dropboxapi.com",
        path,
        method: options.method || "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let data = {};
          try {
            data = text ? JSON.parse(text) : {};
          } catch {
            data = { raw: text };
          }
          if (res.statusCode >= 400) {
            reject(new Error(data.error_summary || data.error?.[".tag"] || text || `Dropbox HTTP ${res.statusCode}`));
          } else {
            resolve(data);
          }
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function contentUpload(path, buffer, fileName) {
  const token = getAccessToken();
  if (!token) throw new Error("Dropbox not configured");

  const dropboxPath = path.startsWith("/") ? path : `/${path}`;
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "content.dropboxapi.com",
        path: "/2/files/upload",
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
          "Dropbox-API-Arg": JSON.stringify({
            path: dropboxPath,
            mode: "add",
            autorename: true,
            mute: false,
          }),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          try {
            const data = JSON.parse(text);
            if (res.statusCode >= 400) reject(new Error(data.error_summary || text));
            else resolve({ ...data, fileName: fileName || data.name, dropboxPath: data.path_display || dropboxPath });
          } catch (e) {
            reject(new Error(text || e.message));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(buffer);
    req.end();
  });
}

async function createSharedLink(dropboxPath, { allowExisting = true } = {}) {
  const path = dropboxPath.startsWith("/") ? dropboxPath : `/${dropboxPath}`;
  if (allowExisting) {
    try {
      const listed = await apiRequest("/2/sharing/list_shared_links", {
        body: { path, direct_only: true },
      });
      const existing = listed.links?.[0]?.url;
      if (existing) return existing;
    } catch (listErr) {
      if (!String(listErr.message || "").toLowerCase().includes("not_found")) {
        /* try create below */
      }
    }
  }
  try {
    const shared = await apiRequest("/2/sharing/create_shared_link_with_settings", {
      body: { path, settings: { requested_visibility: "team" } },
    });
    if (shared.url) return shared.url;
    throw new Error("Dropbox did not return a share URL");
  } catch (err) {
    const msg = String(err.message || "");
    if (msg.toLowerCase().includes("shared_link_already_exists")) {
      const listed = await apiRequest("/2/sharing/list_shared_links", {
        body: { path, direct_only: true },
      });
      const url = listed.links?.[0]?.url;
      if (url) return url;
    }
    throw err;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Import a remote URL into Dropbox (Airtable → Dropbox, no local disk). */
async function importFromUrl({ dropboxPath, sourceUrl }) {
  const path = dropboxPath.startsWith("/") ? dropboxPath : `/${dropboxPath}`;
  const started = await apiRequest("/2/files/save_url", {
    body: { path, url: sourceUrl },
  });

  function fromMeta(meta) {
    return { dropboxPath: meta.path_display || path, fileName: meta.name };
  }

  if (started[".tag"] === "complete" && started.complete) {
    return fromMeta(started.complete);
  }
  if (started.metadata?.path_display) {
    return fromMeta(started.metadata);
  }

  const jobId = started.async_job_id;
  if (!jobId) throw new Error(`save_url: no job id (${JSON.stringify(started).slice(0, 120)})`);

  for (let i = 0; i < 120; i++) {
    await sleep(i === 0 ? 500 : 2000);
    const status = await apiRequest("/2/files/save_url/check_job_status", {
      body: { async_job_id: jobId },
    });
    const tag = status[".tag"];
    if (tag === "complete" && status.complete) {
      return fromMeta(status.complete);
    }
    if (tag === "failed") {
      const reason = status.failed?.[".tag"] || JSON.stringify(status.failed || {});
      throw new Error(`Dropbox save_url failed: ${reason}`);
    }
    if (tag !== "in_progress" && tag !== "async_job_id") {
      throw new Error(`save_url unexpected status: ${tag || "unknown"}`);
    }
  }
  throw new Error("Dropbox save_url timed out");
}

async function importSaleFileFromUrl({ saleId, kind, fileName, sourceUrl }) {
  const safeKind = String(kind || "recording").replace(/[^a-z0-9_-]/gi, "");
  const folder = process.env.DROPBOX_SALES_FOLDER || "/Hangup-HR/Sales";
  const safeName = String(fileName || "attachment").replace(/[/\\]/g, "_");
  const dropboxPath = `${folder}/${saleId || "draft"}/${safeKind}/${Date.now()}-${safeName}`;
  let imported;
  try {
    imported = await importFromUrl({ dropboxPath, sourceUrl });
  } catch (saveUrlErr) {
    const { fetchUrl } = require("./url-fetch");
    const { buffer } = await fetchUrl(sourceUrl);
    const uploaded = await contentUpload(dropboxPath, buffer, safeName);
    imported = { dropboxPath: uploaded.dropboxPath, fileName: uploaded.fileName || safeName };
  }
  const link = await createSharedLink(imported.dropboxPath);
  return {
    dropboxPath: imported.dropboxPath,
    fileName: imported.fileName || safeName,
    dropboxLink: link,
  };
}

function downloadFile(dropboxPath) {
  const token = getAccessToken();
  if (!token) throw new Error("Dropbox not configured");
  const path = dropboxPath.startsWith("/") ? dropboxPath : `/${dropboxPath}`;
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "content.dropboxapi.com",
        path: "/2/files/download",
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Dropbox-API-Arg": JSON.stringify({ path }),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          if (res.statusCode >= 400) {
            return reject(new Error(`Dropbox download HTTP ${res.statusCode}`));
          }
          resolve(Buffer.concat(chunks));
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

async function uploadSaleFile({ saleId, kind, fileName, buffer }) {
  const safeKind = String(kind || "recording").replace(/[^a-z0-9_-]/gi, "");
  const folder = process.env.DROPBOX_SALES_FOLDER || "/Hangup-HR/Sales";
  const path = `${folder}/${saleId || "draft"}/${safeKind}/${Date.now()}-${fileName}`;
  const uploaded = await contentUpload(path, buffer, fileName);
  const link = await createSharedLink(uploaded.dropboxPath);
  return {
    dropboxPath: uploaded.dropboxPath,
    fileName: uploaded.name || fileName,
    dropboxLink: link,
  };
}

async function deleteFile(dropboxPath) {
  if (!dropboxPath) return;
  await apiRequest("/2/files/delete_v2", { body: { path: dropboxPath } });
}

/** Verify a file exists in Dropbox after upload/import. */
async function confirmFileExists(dropboxPath) {
  const path = dropboxPath.startsWith("/") ? dropboxPath : `/${dropboxPath}`;
  const meta = await apiRequest("/2/files/get_metadata", { body: { path } });
  if (meta[".tag"] !== "file") {
    throw new Error(`Dropbox path is not a file: ${path}`);
  }
  return {
    dropboxPath: meta.path_display || path,
    fileName: meta.name,
    size: meta.size,
  };
}

/** Ensure shared link exists; create if missing. */
async function ensureSharedLink(dropboxPath) {
  const path = dropboxPath.startsWith("/") ? dropboxPath : `/${dropboxPath}`;
  try {
    const listed = await apiRequest("/2/sharing/list_shared_links", {
      body: { path, direct_only: true },
    });
    const url = listed.links?.[0]?.url;
    if (url) return url;
  } catch {
    /* create below */
  }
  return createSharedLink(path);
}

module.exports = {
  isConfigured,
  isScopeError,
  verifyAccess,
  importFromUrl,
  importSaleFileFromUrl,
  uploadSaleFile,
  downloadFile,
  deleteFile,
  createSharedLink,
  confirmFileExists,
  ensureSharedLink,
};
