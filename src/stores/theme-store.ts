import { setCompanyContext as persistCompanyContext, getCompanyContext } from "@/api/client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { currentMonth } from "@/api/client";

export type Theme =
  | "light"
  | "dark"
  | "violet"
  | "pink"
  | "red-wine"
  | "diamond"
  | "emerald"
  | "gotham"
  | "hello-kitty"
  | "spiderman"
  | "turtles";

export type ThemeUnlocks = {
  month?: string;
  agentSalesThisMonth?: number;
  closerSalesThisMonth?: number;
  premium?: boolean;
  gotham?: boolean;
  helloKitty?: boolean;
  spiderman?: boolean;
  turtles?: boolean;
  agentThreshold?: number;
  closerThreshold?: number;
  turtleThreshold?: number;
};

const PREMIUM_DESC = "Premium · 10 RPM sent as agent or 10 closed as closer";
const TURTLE_DESC = "Premium · 15 RPM sent as agent or 15 closed as closer";

export const THEMES: {
  id: Theme;
  label: string;
  desc: string;
  premium?: "gotham" | "hello-kitty" | "spiderman" | "turtles";
}[] = [
  { id: "light", label: "Hangup Light", desc: "Warm coral on cream" },
  { id: "dark", label: "Hangup Dark", desc: "Coral accent on charcoal" },
  { id: "violet", label: "Violet", desc: "Purple accent on soft surfaces" },
  { id: "pink", label: "Pink", desc: "Soft rose workspace" },
  { id: "red-wine", label: "Red Wine", desc: "Burgundy on dark" },
  { id: "diamond", label: "Diamond", desc: "Cool silver / ice light" },
  { id: "emerald", label: "Emerald", desc: "Jade green on mint" },
  { id: "gotham", label: "Gotham Night", desc: PREMIUM_DESC, premium: "gotham" },
  { id: "hello-kitty", label: "Hello Kitty", desc: PREMIUM_DESC, premium: "hello-kitty" },
  { id: "spiderman", label: "Spiderman", desc: PREMIUM_DESC, premium: "spiderman" },
  { id: "turtles", label: "Turtle Grove", desc: TURTLE_DESC, premium: "turtles" },
];

export const FREE_THEMES = THEMES.filter((t) => !t.premium).map((t) => t.id);

export function isThemeUnlocked(themeId: Theme, unlocks?: ThemeUnlocks | null): boolean {
  if (themeId === "turtles") {
    return unlocks?.turtles === true;
  }
  if (themeId === "gotham" || themeId === "hello-kitty" || themeId === "spiderman") {
    if (unlocks?.premium === true) return true;
    if (themeId === "gotham") return unlocks?.gotham === true;
    if (themeId === "hello-kitty") return unlocks?.helloKitty === true;
    if (themeId === "spiderman") return unlocks?.spiderman === true;
    return false;
  }
  return true;
}

export function unlockedThemes(unlocks?: ThemeUnlocks | null): Theme[] {
  return THEMES.filter((t) => isThemeUnlocked(t.id, unlocks)).map((t) => t.id);
}

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
  cycleUnlocked: (unlocks?: ThemeUnlocks | null) => void;
  ensureUnlocked: (unlocks?: ThemeUnlocks | null) => void;
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: "light",
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
      toggle: () => {
        const order = THEMES.map((t) => t.id);
        const idx = order.indexOf(get().theme);
        get().setTheme(order[(idx + 1) % order.length]);
      },
      cycleUnlocked: (unlocks) => {
        const order = unlockedThemes(unlocks);
        if (!order.length) return;
        const idx = order.indexOf(get().theme);
        get().setTheme(order[(idx + 1) % order.length]);
      },
      ensureUnlocked: (unlocks) => {
        if (!unlocks) return;
        if (!isThemeUnlocked(get().theme, unlocks)) {
          get().setTheme("light");
        }
      },
    }),
    { name: "hangup-theme" }
  )
);

interface AppState {
  month: string;
  companyContext: string;
  sidebarCollapsed: boolean;
  sidebarPinned: boolean;
  setMonth: (m: string) => void;
  setCompanyContext: (c: string) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;
  setSidebarPinned: (v: boolean) => void;
}

export const useAppStore = create<AppState>()((set, get) => ({
  month: currentMonth(),
  companyContext: getCompanyContext(),
  sidebarCollapsed: true,
  sidebarPinned: false,
  setMonth: (month) => set({ month }),
  setCompanyContext: (companyContext) => {
    persistCompanyContext(companyContext);
    set({ companyContext });
  },
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    set({ sidebarCollapsed: next, sidebarPinned: !next });
  },
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  setSidebarPinned: (sidebarPinned) => set({ sidebarPinned, sidebarCollapsed: !sidebarPinned }),
}));
