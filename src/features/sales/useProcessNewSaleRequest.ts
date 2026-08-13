import { useCallback } from "react";
import type { SalesProgram } from "./sale-program";
import { parseSalesProgram, resolveSingleSubmitProgram } from "./sale-program";

export function useProcessNewSaleRequest(opts: {
  enabledPrograms: string[];
  canSubmitMla: boolean;
  canSubmitRpm: boolean;
  needsProgramPicker: boolean;
  openNewSaleForm: (program: SalesProgram) => void;
  openProgramPicker: () => void;
}) {
  const {
    enabledPrograms,
    canSubmitMla,
    canSubmitRpm,
    needsProgramPicker,
    openNewSaleForm,
    openProgramPicker,
  } = opts;

  return useCallback(
    (requestedProgram?: SalesProgram | null) => {
      const explicit = requestedProgram ?? null;
      if (explicit === "mla" && canSubmitMla) {
        openNewSaleForm("mla");
        return true;
      }
      if (explicit === "rpm" && canSubmitRpm) {
        openNewSaleForm("rpm");
        return true;
      }

      const single = resolveSingleSubmitProgram(enabledPrograms);
      if (single) {
        openNewSaleForm(single);
        return true;
      }
      if (needsProgramPicker) {
        openProgramPicker();
        return true;
      }
      return false;
    },
    [enabledPrograms, canSubmitMla, canSubmitRpm, needsProgramPicker, openNewSaleForm, openProgramPicker]
  );
}

export { parseSalesProgram };
