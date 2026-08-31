/** Open Hangup Dialog count — nested Confirm must not strip parent locks. */
let openDialogCount = 0;

export function acquireDialogLock() {
  openDialogCount += 1;
}

export function releaseDialogLock() {
  openDialogCount = Math.max(0, openDialogCount - 1);
}

export function getOpenDialogCount() {
  return openDialogCount;
}

function hasStuckBodyPointerEvents() {
  if (typeof document === "undefined") return false;
  return document.body.style.pointerEvents === "none";
}

function hasStuckScrollLock() {
  if (typeof document === "undefined") return false;
  return (
    document.body.hasAttribute("data-scroll-locked") ||
    document.documentElement.hasAttribute("data-scroll-locked")
  );
}

function hasOrphanFocusGuards() {
  if (typeof document === "undefined") return false;
  return document.querySelectorAll("[data-radix-focus-guard]").length > 0;
}

/**
 * True when Electron/Radix left residue that blocks typing.
 * While a Hangup Dialog is open, Radix intentionally sets scroll-lock + focus-guards —
 * that is NOT residue. Only treat stuck body pointer-events as leftover in that case,
 * so Select search / focus inside dialogs is not slowed by clearing on every event.
 */
export function hasUiBlockerResidue() {
  if (openDialogCount > 0) {
    return hasStuckBodyPointerEvents();
  }
  return hasStuckBodyPointerEvents() || hasStuckScrollLock() || hasOrphanFocusGuards();
}

/**
 * Clear Radix / modal / alert leftovers that block typing (Electron).
 * When a Dialog is still open, only clear stuck body pointer-events — do not
 * strip scroll-lock attrs or focus-guards that the parent dialog still owns.
 */
export function clearUiBlockers(opts?: { force?: boolean }) {
  if (typeof document === "undefined") return;
  const force = opts?.force === true;
  const dialogsOpen = openDialogCount > 0;

  if (hasStuckBodyPointerEvents()) {
    document.body.style.pointerEvents = "";
  }

  if (force || !dialogsOpen) {
    document.body.style.overflow = "";
    document.body.removeAttribute("data-scroll-locked");
    document.documentElement.removeAttribute("data-scroll-locked");
    document.querySelectorAll("[data-radix-focus-guard]").forEach((el) => el.remove());
  }
}

/** Clear only if residue is present (safe after OS date/file pickers / window focus). */
export function clearUiBlockersIfResidue() {
  if (!hasUiBlockerResidue()) return;
  clearUiBlockers();
}
