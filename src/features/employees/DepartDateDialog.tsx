import { Dialog } from "@/ui/Dialog";
import { Button } from "@/ui/Button";
import { FormField, FormGrid } from "@/ui/FormGrid";
import type { DepartFormState } from "@/lib/employeeStatus";
import { NOTICE_TYPE_OPTIONS } from "@/lib/employeeStatus";

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
  const today = new Date().toISOString().slice(0, 10);

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
          <Button onClick={onConfirm} disabled={isPending}>
            {isPending ? "Saving…" : confirmLabel}
          </Button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        {subtitle ||
          "Skip the date to use today. You can change the depart date later. Days after depart are locked in attendance until re-hire."}
      </p>
      <FormGrid>
        <FormField label="Depart date">
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.35rem" }}>
            <input
              type="checkbox"
              checked={form.useCustomDate}
              onChange={(e) =>
                onFormChange({
                  ...form,
                  useCustomDate: e.target.checked,
                  departDate: e.target.checked ? form.departDate || today : "",
                })
              }
            />
            Choose a specific depart date
          </label>
          {form.useCustomDate ? (
            <input
              type="date"
              value={form.departDate}
              onChange={(e) => onFormChange({ ...form, departDate: e.target.value })}
            />
          ) : (
            <span className="muted">Today ({today})</span>
          )}
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
              onFormChange({ ...form, notice_type: e.target.value as DepartFormState["notice_type"] })
            }
          >
            {NOTICE_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {form.notice_type === "without_notice" && (
            <span className="muted" style={{ fontSize: "0.75rem", display: "block", marginTop: "0.25rem" }}>
              Two weeks basic + transport will be deducted from final pay.
            </span>
          )}
          {form.notice_type === "company_decision" && (
            <span className="muted" style={{ fontSize: "0.75rem", display: "block", marginTop: "0.25rem" }}>
              Full final pay — no leaving deductions.
            </span>
          )}
        </FormField>
      </FormGrid>
    </Dialog>
  );
}
