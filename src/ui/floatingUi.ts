/** Shared marker for portaled menus so Radix Dialog does not steal pointer/focus. */
export const FLOATING_UI_ATTR = "data-hangup-floating";

export function isHangupFloatingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el?.closest?.(`[${FLOATING_UI_ATTR}]`));
}

export function isHangupFloatingEvent(e: {
  target?: EventTarget | null;
  detail?: { originalEvent?: { target?: EventTarget | null } };
}): boolean {
  return isHangupFloatingTarget(e.target ?? null) || isHangupFloatingTarget(e.detail?.originalEvent?.target ?? null);
}
