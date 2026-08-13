import { Dialog } from "@/ui/Dialog";
import { Button } from "@/ui/Button";
import { LeaveDocsPanel } from "./LeaveDocsPanel";

export function LeaveDocsDialog({
  open,
  onOpenChange,
  leaveId,
  employeeId,
  requestKind,
  path,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leaveId: string;
  employeeId: string;
  requestKind: string;
  path: (p: string) => string;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Leave documents"
      footer={<Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>}
    >
      <LeaveDocsPanel
        leaveId={leaveId}
        employeeId={employeeId}
        requestKind={requestKind}
        path={path}
      />
    </Dialog>
  );
}
