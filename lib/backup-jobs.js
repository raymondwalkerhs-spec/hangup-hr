const jobs = new Map();
let seq = 0;

function createJob(type, meta = {}) {
  const id = `job-${Date.now()}-${++seq}`;
  const job = {
    id,
    type,
    status: "pending",
    phase: "",
    progress: 0,
    message: "Starting…",
    outputDir: meta.outputDir || "",
    startedAt: Date.now(),
    finishedAt: null,
    result: null,
    error: null,
  };
  jobs.set(id, job);
  return job;
}

function getJob(id) {
  return jobs.get(id) || null;
}

function updateJob(id, patch) {
  const job = jobs.get(id);
  if (!job) return null;
  Object.assign(job, patch);
  jobs.set(id, job);
  return job;
}

function completeJob(id, result) {
  return updateJob(id, { status: "done", progress: 100, finishedAt: Date.now(), result });
}

function failJob(id, error) {
  return updateJob(id, {
    status: "failed",
    finishedAt: Date.now(),
    error: String(error?.message || error),
    message: String(error?.message || error),
  });
}

function pruneOldJobs(maxAgeMs = 6 * 60 * 60 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  for (const [id, job] of jobs.entries()) {
    if (job.finishedAt && job.finishedAt < cutoff) jobs.delete(id);
  }
}

module.exports = { createJob, getJob, updateJob, completeJob, failJob, pruneOldJobs };
