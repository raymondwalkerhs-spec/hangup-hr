import { Command } from "cmdk";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useWorkspaceStore } from "@/stores/cross-filter-store";
import { NAV_ITEMS } from "@/app/nav-config";
import { useAuth } from "@/app/AuthProvider";
import { canAccessPage, type StatusUser } from "@/lib/nav-access";
import { useSalesIntentStore } from "@/stores/sales-intent-store";
import styles from "./CommandPalette.module.css";

export function CommandPalette() {
  const { commandOpen, setCommandOpen } = useWorkspaceStore();
  const navigate = useNavigate();
  const { status } = useAuth();
  const user = status?.user as StatusUser | undefined;
  const visibleNav = NAV_ITEMS.filter((item) => canAccessPage(user, item.page));
  const canCosts = user?.canAccessCosts === true || user?.canSubmitExpense === true;
  const canSales = user?.canSubmitSales === true;
  const canIt = user?.canViewItRequests === true || user?.canSubmitItRequest === true;
  const canChecks = user?.canSubmitRpmChecks === true;
  const canQFeedback = user?.canSubmitRpmQFeedback === true;
  const requestNewSale = useSalesIntentStore((s) => s.requestNewSale);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandOpen(!commandOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commandOpen, setCommandOpen]);

  const go = (path: string) => {
    navigate(path);
    setCommandOpen(false);
  };

  const goNewSale = () => {
    requestNewSale();
    go("/sales");
  };

  if (!commandOpen) return null;

  return (
    <div className={styles.overlay} onClick={() => setCommandOpen(false)}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <Command label="Command palette">
          <Command.Input placeholder="Search pages and actions…" autoFocus />
          <Command.List>
            <Command.Empty>No results.</Command.Empty>
            <Command.Group heading="Navigate">
              {visibleNav.map((item) => (
                <Command.Item key={item.path} onSelect={() => go(item.path)}>
                  {item.label}
                </Command.Item>
              ))}
            </Command.Group>
            <Command.Group heading="Actions">
              {canSales && <Command.Item onSelect={goNewSale}>+ New sale</Command.Item>}
              {canChecks && (
                <Command.Item onSelect={() => go("/checks?action=new")}>+ New check</Command.Item>
              )}
              {canQFeedback && (
                <Command.Item onSelect={() => go("/q-feedback?action=new")}>+ Q feedback</Command.Item>
              )}
              <Command.Item onSelect={() => go("/requests")}>+ Leave request</Command.Item>
              {canIt && <Command.Item onSelect={() => go("/it-requests?action=new")}>+ IT ticket</Command.Item>}
              {canCosts && <Command.Item onSelect={() => go("/costs")}>View costs</Command.Item>}
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
