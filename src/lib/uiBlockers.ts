/** Clear Radix / modal / alert leftovers that block typing in search fields (Electron). */
export function clearUiBlockers() {
  if (typeof document === "undefined") return;
  document.body.style.pointerEvents = "";
  document.body.style.overflow = "";
  document.body.removeAttribute("data-scroll-locked");
  document.documentElement.removeAttribute("data-scroll-locked");
  document.querySelectorAll("[data-radix-focus-guard]").forEach((el) => el.remove());
}
