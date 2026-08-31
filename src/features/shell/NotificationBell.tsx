import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { api } from "@/api/client";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { Button } from "@/ui/Button";
import styles from "./NotificationBell.module.css";
import { LIVE_REFETCH_MS } from "@/lib/liveRefresh";

type Notif = {
  id: string;
  title?: string;
  body?: string;
  readAt?: string | null;
  entityType?: string;
  entityId?: string;
  type?: string;
  actionKey?: string;
  persisted?: boolean;
};

type NotifPayload = {
  notifications?: Notif[];
  unreadCount?: number;
};

function navFor(n: Notif): string | null {
  const t = n.entityType || n.type || n.actionKey || "";
  if (t.includes("sale") || t === "sale") return "/sales";
  if (t.includes("leave") || t === "leave_request") return "/requests";
  if (t.includes("meeting")) return "/meeting-requests";
  if (t.includes("it_request")) return "/it-requests";
  if (t.includes("loan")) return "/loan-approvals";
  if (t.includes("deduction")) return "/deductions";
  if (t.includes("bonus")) return "/bonuses";
  if (t.includes("payslip") || t.includes("payroll")) return "/payroll";
  if (t.includes("registration")) return "/org";
  if (t.includes("rpm_sale_duplicate") || t.includes("duplicate")) return "/sales";
  if (t.includes("announcement")) {
    return n.entityId ? `/announcements?open=${encodeURIComponent(n.entityId)}` : "/announcements";
  }
  return null;
}

function isUnread(n: Notif) {
  return n.persisted === true && !n.readAt;
}

function markAllReadInCache(data: NotifPayload | undefined): NotifPayload | undefined {
  if (!data) return data;
  const now = new Date().toISOString();
  return {
    ...data,
    unreadCount: 0,
    notifications: (data.notifications || []).map((n) =>
      n.persisted ? { ...n, readAt: n.readAt || now } : n
    ),
  };
}

export function NotificationBell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { path, companyContext } = useCompanyScope();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState({ top: 0, right: 0 });
  const queryKey = ["hrms-notifications", companyContext] as const;

  const { data } = useQuery({
    queryKey,
    queryFn: () => api<NotifPayload>(path("/hrms/notifications")),
    refetchInterval: LIVE_REFETCH_MS,
    refetchIntervalInBackground: false,
  });

  const markRead = useMutation({
    mutationFn: (id: string) =>
      api(path(`/hrms/notifications/${encodeURIComponent(id)}/read`), { method: "POST", body: "{}" }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<NotifPayload>(queryKey);
      qc.setQueryData<NotifPayload>(queryKey, (old) => {
        if (!old) return old;
        const notifications = (old.notifications || []).map((n) =>
          n.id === id ? { ...n, readAt: n.readAt || new Date().toISOString() } : n
        );
        const unreadCount = notifications.filter(isUnread).length;
        return { ...old, notifications, unreadCount };
      });
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey }),
  });

  const markAll = useMutation({
    mutationFn: () => api(path("/hrms/notifications/read-all"), { method: "POST", body: "{}" }),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<NotifPayload>(queryKey);
      qc.setQueryData<NotifPayload>(queryKey, (old) => markAllReadInCache(old));
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey }),
  });

  const items = data?.notifications || [];
  const unread = data?.unreadCount ?? items.filter(isUnread).length;
  const prevUnread = useRef(unread);
  const [pulse, setPulse] = useState(false);

  const placePanel = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPanelPos({
      top: r.bottom + 6,
      right: Math.max(8, window.innerWidth - r.right),
    });
  }, []);

  useLayoutEffect(() => {
    setOpen(false);
  }, [location.pathname, location.key, companyContext]);

  useLayoutEffect(() => {
    if (!open) return;
    placePanel();
    const onReposition = () => placePanel();
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, placePanel]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (btnRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("touchstart", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("touchstart", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (unread > prevUnread.current) {
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 500);
      prevUnread.current = unread;
      return () => clearTimeout(t);
    }
    prevUnread.current = unread;
  }, [unread]);

  const panel =
    open &&
    createPortal(
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-label="Notifications"
        style={{ top: panelPos.top, right: panelPos.right }}
      >
        <div className={styles.header}>
          <strong>Notifications</strong>
          {unread > 0 && (
            <Button
              size="sm"
              variant="ghost"
              disabled={markAll.isPending}
              onClick={(e) => {
                e.stopPropagation();
                markAll.mutate();
              }}
            >
              {markAll.isPending ? "Saving…" : "Mark all read"}
            </Button>
          )}
        </div>
        {markAll.isError && (
          <p className={styles.errorNote}>{(markAll.error as Error)?.message || "Could not mark all read"}</p>
        )}
        {items.length === 0 && <p className="muted">No notifications</p>}
        {items.map((n) => (
          <div
            key={n.id}
            className={`${styles.item} ${isUnread(n) ? styles.itemUnread : ""}`}
            onClick={() => {
              if (isUnread(n)) markRead.mutate(n.id);
              const dest = navFor(n);
              setOpen(false);
              if (dest) navigate(dest);
            }}
          >
            <div>{n.title || "Notification"}</div>
            {n.body && <div className="muted" style={{ fontSize: "0.75rem" }}>{n.body}</div>}
          </div>
        ))}
      </div>,
      document.body
    );

  return (
    <div className={styles.wrap}>
      <button
        ref={btnRef}
        type="button"
        className={`${styles.btn} ${unread > 0 ? styles.btnHasItems : ""} ${pulse ? styles.pulse : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        aria-expanded={open}
      >
        <Bell size={16} />
        {unread > 0 && <span className={styles.badge}>{unread > 99 ? "99+" : unread}</span>}
      </button>
      {panel}
    </div>
  );
}
