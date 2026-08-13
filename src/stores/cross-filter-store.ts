import { create } from "zustand";

export interface CrossFilter {
  month?: string;
  team?: string;
  employeeId?: string;
  status?: string;
  category?: string;
  unit?: string;
}

interface CrossFilterState {
  filters: CrossFilter;
  setFilter: (key: keyof CrossFilter, value: string | undefined) => void;
  clearFilter: (key: keyof CrossFilter) => void;
  clearAll: () => void;
}

export const useCrossFilterStore = create<CrossFilterState>((set) => ({
  filters: {},
  setFilter: (key, value) =>
    set((s) => ({
      filters: value ? { ...s.filters, [key]: value } : (() => {
        const next = { ...s.filters };
        delete next[key];
        return next;
      })(),
    })),
  clearFilter: (key) =>
    set((s) => {
      const next = { ...s.filters };
      delete next[key];
      return { filters: next };
    }),
  clearAll: () => set({ filters: {} }),
}));

interface InspectorState {
  open: boolean;
  title: string;
  content: React.ReactNode | null;
  history: Array<{ title: string; content: React.ReactNode }>;
  openInspector: (title: string, content: React.ReactNode) => void;
  closeInspector: () => void;
  backInspector: () => void;
}

export const useInspectorStore = create<InspectorState>((set, get) => ({
  open: false,
  title: "",
  content: null,
  history: [],
  openInspector: (title, content) =>
    set((s) => ({
      open: true,
      title,
      content,
      history: s.open ? [...s.history, { title: s.title, content: s.content }] : [],
    })),
  closeInspector: () => set({ open: false, title: "", content: null, history: [] }),
  backInspector: () => {
    const { history } = get();
    if (!history.length) {
      get().closeInspector();
      return;
    }
    const prev = history[history.length - 1];
    set({
      history: history.slice(0, -1),
      title: prev.title,
      content: prev.content,
    });
  },
}));

interface WorkspaceState {
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  commandOpen: false,
  setCommandOpen: (commandOpen) => set({ commandOpen }),
}));
