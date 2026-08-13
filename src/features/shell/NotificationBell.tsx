import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { api } from "@/api/client";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { Button } from "@/ui/Button";
import styles from "./NotificationBell.module.css";

type Notif = {
  id: string;
  title?: string;
  body?: string;
  readAt?: string | null;
  entityType?: string;
  entityId?: string;
  type?: string;
  actionKey?: string;
};

function navFor(n: Notif): string | null {
  const t = n.entityType || n.type || n.actionKey || "";
  if (t.includes("sale") || t === "sale") return "/sales";
  if (t.includes("leave") || t === "leave_request") return "/requests";
  if (t.includes("meeting")) return "/meeting-requests";
  if (t.includes("it_request")) return "/it-requests";
  if (t.includes("loan")) return "/loan-approvals";
  if (t.includes("bonus")) return "/bonuses";
  if (t.includes("registration")) return "/org";
  if (t.includes("announcement")) {
    return n.entityId ? `/announcements?open=${encodeURIComponent(n.entityId)}` : "/announcements";
  }
  return null;
}

export function NotificationBell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { path, companyContext } = useCompanyScope();
  const [open, setOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ["hrms-notifications", companyContext],
    queryFn: () => api<{ notifications?: Notif[]; unreadCount?: number }>(path("/hrms/notifications")),
    refetchInterval: 30000,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api(path(`/hrms/notifications/${encodeURIComponent(id)}/read`), { method: "POST", body: "{}" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hrms-notifications"] }),
  });

  const markAll = useMutation({
    mutationFn: () => api(path("/hrms/notifications/read-all"), { method: "POST", body: "{}" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hrms-notifications"] }),
  });

  const items = data?.notifications || [];
  const unread = data?.unreadCount ?? items.filter((n) => !n.readAt).length;

  return (
    <div className={styles.wrap}>
      <button type="button" className={`${styles.btn} ${unread > 0 ? styles.btnHasItems : ""}`} onClick={() => setOpen((o) => !o)} aria-label="Notifications">
        <Bell size={16} />
        {unread > 0 && <span className={styles.badge}>{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className={styles.panel}>
          <div className={styles.header}>
            <strong>Notifications</strong>
            {unread > 0 && <Button size="sm" variant="ghost" onClick={() => markAll.mutate()}>Mark all read</Button>}
          </div>
          {items.length === 0 && <p className="muted">No notifications</p>}
          {items.map((n) => (
            <div
              key={n.id}
              className={`${styles.item} ${!n.readAt ? styles.itemUnread : ""}`}
              onClick={() => {
                if (!n.readAt) markRead.mutate(n.id);
                const path = navFor(n);
                if (path) { navigate(path); setOpen(false); }
              }}
            >
              <div>{n.title || "Notification"}</div>
              {n.body && <div className="muted" style={{ fontSize: "0.75rem" }}>{n.body}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
