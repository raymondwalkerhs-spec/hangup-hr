(function () {
  const SESSION_KEY = "hr_backup_session";
  const FOLDER_KEY = "hr_backup_output_dir";

  const folderPathEl = document.getElementById("folder-path");
  const progressCard = document.getElementById("progress-card");
  const progressFill = document.getElementById("progress-fill");
  const progressMsg = document.getElementById("progress-msg");
  const progressTitle = document.getElementById("progress-title");
  const donePathEl = document.getElementById("done-path");
  const openFolderBtn = document.getElementById("open-folder-btn");

  let outputDir = localStorage.getItem(FOLDER_KEY) || "";
  let pollTimer = null;

  if (!sessionStorage.getItem(SESSION_KEY)) {
    location.href = "/login";
    return;
  }

  function sessionId() {
    return sessionStorage.getItem(SESSION_KEY) || "";
  }

  function headers(extra) {
    const h = { "x-session-id": sessionId() };
    return Object.assign(h, extra || {});
  }

  async function api(url, opts) {
    opts = opts || {};
    const init = Object.assign({}, opts);
    init.headers = headers(opts.headers || {});
    if (init.body && !init.headers["Content-Type"]) {
      init.headers["Content-Type"] = "application/json";
    }
    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      sessionStorage.removeItem(SESSION_KEY);
      if (window.hrBackup && window.hrBackup.clearSession) await window.hrBackup.clearSession();
      location.href = "/login";
      throw new Error("Session expired");
    }
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  function setFolder(dir) {
    outputDir = dir || "";
    if (outputDir) localStorage.setItem(FOLDER_KEY, outputDir);
    else localStorage.removeItem(FOLDER_KEY);
    folderPathEl.textContent = outputDir || "No folder selected";
    folderPathEl.classList.toggle("muted", !outputDir);
  }

  function showProgress(title) {
    progressCard.classList.remove("hidden");
    progressTitle.textContent = title;
    progressFill.style.width = "0%";
    progressMsg.textContent = "Starting…";
    donePathEl.classList.add("hidden");
    openFolderBtn.classList.add("hidden");
  }

  function updateProgress(job) {
    progressFill.style.width = Math.min(100, job.progress || 0) + "%";
    progressMsg.textContent = job.message || "";
    if (job.status === "done" && job.result && job.result.root) {
      progressTitle.textContent = "Backup complete";
      donePathEl.textContent = job.result.root;
      donePathEl.classList.remove("hidden");
      openFolderBtn.classList.remove("hidden");
      openFolderBtn.onclick = function () {
        if (window.hrBackup && window.hrBackup.openPath) window.hrBackup.openPath(job.result.root);
      };
    }
    if (job.status === "failed") {
      progressTitle.textContent = "Backup failed";
    }
  }

  async function pollJob(jobId) {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async function () {
      try {
        const data = await api("/api/backup/jobs/" + encodeURIComponent(jobId), { method: "GET" });
        const job = data.job;
        updateProgress(job);
        if (job.status === "done" || job.status === "failed") {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      } catch (e) {
        clearInterval(pollTimer);
        pollTimer = null;
        progressMsg.textContent = e.message;
      }
    }, 800);
  }

  async function startBackup(kind) {
    if (!outputDir) throw new Error("Choose a backup folder first.");
    showProgress(kind === "full" ? "Full backup" : "Sales backup");
    const body = { outputDir: outputDir };
    if (kind === "sales") {
      const from = document.getElementById("sales-from").value;
      const to = document.getElementById("sales-to").value;
      if (from) body.from = from;
      if (to) body.to = to;
    }
    const data = await api("/api/backup/" + kind, { method: "POST", body: JSON.stringify(body) });
    await pollJob(data.jobId);
  }

  setFolder(outputDir);

  api("/api/backup/me", { method: "GET" })
    .then(function (me) {
      document.getElementById("user-line").textContent = me.username + " (" + me.role + ")";
    })
    .catch(function (e) {
      document.getElementById("user-line").textContent = e.message;
    });

  document.getElementById("pick-folder-btn").addEventListener("click", async function () {
    if (window.hrBackup && window.hrBackup.pickFolder) {
      const dir = await window.hrBackup.pickFolder();
      if (dir) setFolder(dir);
      return;
    }
    const dir = window.prompt("Enter full path to backup folder:");
    if (dir) setFolder(dir.trim());
  });

  document.getElementById("full-backup-btn").addEventListener("click", function () {
    startBackup("full").catch(function (e) {
      progressMsg.textContent = e.message;
    });
  });

  document.getElementById("sales-backup-btn").addEventListener("click", function () {
    startBackup("sales").catch(function (e) {
      progressMsg.textContent = e.message;
    });
  });

  document.getElementById("logout-btn").addEventListener("click", async function () {
    try {
      await api("/api/backup/logout", { method: "POST", body: "{}" });
    } catch (_) {}
    sessionStorage.removeItem(SESSION_KEY);
    if (window.hrBackup && window.hrBackup.clearSession) await window.hrBackup.clearSession();
    location.href = "/login";
  });
})();