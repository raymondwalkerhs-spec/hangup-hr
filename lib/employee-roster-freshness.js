const DEFAULT_MAX_AGE_MS = 15_000;

function createEmployeeRosterFreshness(refreshFn, { now = () => Date.now(), maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  let lastAt = 0;
  let inFlight = null;

  function markFresh() {
    lastAt = now();
  }

  function reset() {
    lastAt = 0;
    inFlight = null;
  }

  async function ensureFresh({ force = false, maxAgeMs: age = maxAgeMs } = {}) {
    const t = now();
    if (!force && lastAt && t - lastAt < age) {
      return { skipped: true, lastAt };
    }
    if (inFlight) return inFlight;
    inFlight = Promise.resolve()
      .then(() => refreshFn())
      .then((result) => {
        markFresh();
        return result;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  return { ensureFresh, markFresh, reset, DEFAULT_MAX_AGE_MS };
}

module.exports = {
  DEFAULT_MAX_AGE_MS,
  createEmployeeRosterFreshness,
};
