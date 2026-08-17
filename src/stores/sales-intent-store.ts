import { create } from "zustand";
import type { SalesProgram } from "@/features/sales/sale-program";

type SalesIntentState = {
  /** Increments on each new-sale request (works even when already on /sales). */
  tick: number;
  /** Explicit program, or undefined to auto-resolve / show picker. */
  program?: SalesProgram | null;
  requestNewSale: (program?: SalesProgram | null) => void;
  /** Clear leftover intent so a later /sales visit does not reopen the form. */
  consumeNewSale: () => void;
};

export const useSalesIntentStore = create<SalesIntentState>((set) => ({
  tick: 0,
  program: undefined,
  requestNewSale: (program) =>
    set((s) => ({
      tick: s.tick + 1,
      program,
    })),
  consumeNewSale: () => set({ tick: 0, program: undefined }),
}));
