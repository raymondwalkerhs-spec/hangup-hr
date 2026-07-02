(function () {
  const STORAGE_KEY = "hr_ui_theme";
  const DEFAULT = "light";

  const THEMES = [
    { id: "light", label: "Light mode", desc: "Default indigo layout" },
    { id: "dark", label: "Dark mode", desc: "Dark surfaces, indigo accents" },
    { id: "grey", label: "Grey UI", desc: "Neutral grey throughout" },
    { id: "dark-wine", label: "Dark wine", desc: "Burgundy on dark" },
    { id: "dark-grey", label: "Dark grey", desc: "Charcoal monochrome" },
    { id: "alabaster", label: "Alabaster", desc: "Warm cream and taupe" },
    { id: "girly-pink", label: "Girly pink", desc: "Soft pink palette with ribbon accents" },
  ];

  function isValid(id) {
    return THEMES.some((t) => t.id === id);
  }

  function get() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return isValid(saved) ? saved : DEFAULT;
    } catch {
      return DEFAULT;
    }
  }

  function apply(themeId) {
    const id = isValid(themeId) ? themeId : DEFAULT;
    document.documentElement.setAttribute("data-theme", id);
  }

  function set(themeId) {
    const id = isValid(themeId) ? themeId : DEFAULT;
    apply(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }

  function init() {
    apply(get());
  }

  window.HRTheme = { THEMES, DEFAULT, get, set, apply, init };
  init();
})();
