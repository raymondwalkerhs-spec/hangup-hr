import { setCompanyContext as persistCompanyContext, getCompanyContext } from "@/api/client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { currentMonth } from "@/api/client";

export type Theme = "light" | "dark" | "violet" | "pink" | "red-wine" | "diamond" | "emerald";

export const THEMES: { id: Theme; label: string; desc: string }[] = [
  { id: "light", label: "Hangup Light", desc: "Warm coral on cream" },
  { id: "dark", label: "Hangup Dark", desc: "Coral accent on charcoal" },
  { id: "violet", label: "Violet", desc: "Purple accent on soft surfaces" },
  { id: "pink", label: "Pink", desc: "Soft rose workspace" },
  { id: "red-wine", label: "Red Wine", desc: "Burgundy on dark" },
  { id: "diamond", label: "Diamond", desc: "Cool silver / ice light" },
  { id: "emerald", label: "Emerald", desc: "Jade green on mint" },
];

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: "light",
      setTheme: (theme) => {
        document.documentElement.setAttribute("data-theme", theme);
        set({ theme });
      },
      toggle: () => {
        const order = THEMES.map((t) => t.id);
        const idx = order.indexOf(get().theme);
        get().setTheme(order[(idx + 1) % order.length]);
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
