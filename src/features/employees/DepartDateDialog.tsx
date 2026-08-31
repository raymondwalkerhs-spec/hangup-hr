import { Dialog } from "@/ui/Dialog";
import { Button } from "@/ui/Button";
import { FormField, FormGrid } from "@/ui/FormGrid";
import type { DepartFormState } from "@/lib/employeeStatus";
import { NOTICE_TYPE_OPTIONS, localTodayIso } from "@/lib/employeeStatus";

export function DepartDateDialog({
  open,
  onOpenChange,
  title = "Mark depart",
  subtitle,
  form,
  onFormChange,
  onConfirm,
  confirmLabel = "Save depart",
  isPending,
  secondaryAction,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  subtitle?: string;
  form: DepartFormState;
  onFormChange: (next: DepartFormState) => void;
  onConfirm: () => void;
  confirmLabel?: string;
  isPending?: boolean;
  secondaryAction?: { label: string; onClick: () => void; disabled?: boolean };
}) {
  const today = localTodayIso();

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          {secondaryAction && (
            <Button
              variant="outline"
              onClick={secondaryAction.onClick}
              disabled={isPending || secondaryAction.disabled}
            >
              {secondaryAction.label}
            </Button>
          )}
          <Button onClick={onConfirm} disabled={isPending || !form.departDate}>
            {isPending ? "Saving…" : confirmLabel}
          </Button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        {subtitle ||
          "Pick the depart date (defaults to today). Days after depart are locked in attendance until re-hire."}
      </p>
      <FormGrid>
        <FormField label="Depart date">
          <input
            type="date"
            value={form.departDate || today}
            onChange={(e) =>
              onFormChange({
                ...form,
                useCustomDate: true,
                departDate: e.target.value || today,
              })
            }
          />
          <span className="muted" style={{ fontSize: "0.8rem", display: "block", marginTop: "0.25rem" }}>
            Today is {today}
          </span>
        </FormField>
        <FormField label="Status">
          <select
            value={form.status}
            onChange={(e) =>
              onFormChange({ ...form, status: e.target.value as DepartFormState["status"] })
            }
          >
            <option value="out">Out</option>
            <option value="out_still_paid">Out — still get paid</option>
          </select>
        </FormField>
        <FormField label="Leaving type">
          <select
            value={form.notice_type}
            onChange={(e) =>
              onFormChange({
                ...form,
                notice_type: e.target.value as DepartFormState["notice_type"],
              })
            }
          >
            {NOTICE_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </FormField>
      </FormGrid>
    </Dialog>
  );
}
