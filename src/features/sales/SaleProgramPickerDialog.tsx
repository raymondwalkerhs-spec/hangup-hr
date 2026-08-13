import { Dialog } from "@/ui/Dialog";
import { Button } from "@/ui/Button";
import type { SalesProgram } from "./sale-program";
import styles from "./SaleProgramPickerDialog.module.css";

export function SaleProgramPickerDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (program: SalesProgram) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New sale"
      footer={
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
      }
    >
      <p className="muted">Choose which sales program to submit.</p>
      <div className={styles.options}>
        <button
          type="button"
          className={styles.option}
          onClick={() => {
            onSelect("mla");
            onOpenChange(false);
          }}
        >
          <strong>MLA</strong>
          <span>Medical alert sales — MLA dialing teams</span>
        </button>
        <button
          type="button"
          className={styles.option}
          onClick={() => {
            onSelect("rpm");
            onOpenChange(false);
          }}
        >
          <strong>RPM</strong>
          <span>RPM product sales — RPM dialing teams</span>
        </button>
      </div>
    </Dialog>
  );
}
