import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useAuth } from "@/app/AuthProvider";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { Button } from "@/ui/Button";
import { Card, StatTile } from "@/ui/Card";
import { EmptyState } from "@/ui/EmptyState";
import { QueryErrorCard } from "@/ui/QueryErrorCard";
import { SectionHeader } from "@/ui/SectionHeader";
import { Skeleton } from "@/ui/Skeleton";
import styles from "./CheckDuplicatesPage.module.css";

type ReviewStatus = "q" | "nq" | "age_limit" | "under_age";

type DuplicateCheck = {
  id: string;
  agentId?: string;
  agentName?: string;
  memberId?: string;
  fullName?: string;
  dob?: string;
  phone?: string;
  checkStatus?: string;
  duplicateOfId?: string;
  duplicateReason?: string;
  createdAt?: string;
  created_at?: string;
};

const REVIEW_STATUSES: { value: ReviewStatus; label: string }[] = [
  { value: "q", label: "Mark Q" },
  { value: "nq", label: "Mark NQ" },
  { value: "age_limit", label: "Age limit" },
  { value: "under_age", label: "Under age" },
];

function rowsFromResponse(data: unknown): DuplicateCheck[] {
  if (Array.isArray(data)) return data as DuplicateCheck[];
  const record = (data || {}) as Record<string, unknown>;
  const rows = record.checks ?? record.rpmChecks ?? record.items ?? record.rows;
  return Array.isArray(rows) ? (rows as DuplicateCheck[]) : [];
}

function createdAt(row: DuplicateCheck) {
  return row.createdAt || row.created_at || "";
}

export default function CheckDuplicatesPage() {
  const { user, status } = useAuth();
  const { path, companyContext } = useCompanyScope();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>("q");
  const role = String(user?.role || "").toLowerCase();
  const canReview =
    ["admin", "rtm", "ceo"].includes(role) ||
    status?.canReviewRpmDuplicates === true ||
    status?.canManageRpmChecks === true;

  const duplicatesQuery = useQuery({
    queryKey: ["rpm-checks", "duplicates", companyContext],
    queryFn: () => api(path("/rpm-checks?checkStatus=duplicate")),
    enabled: canReview,
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, checkStatus }: { id: string; checkStatus: ReviewStatus }) =>
      api(path(`/rpm-checks/${encodeURIComponent(id)}`), {
        method: "PATCH",
        body: JSON.stringify({ checkStatus }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["rpm-checks"] });
      setReviewingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(path(`/rpm-checks/${encodeURIComponent(id)}`), { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rpm-checks"] }),
  });

  const rows = useMemo(
    () => rowsFromResponse(duplicatesQuery.data).filter((row) => !row.checkStatus || row.checkStatus === "duplicate"),
    [duplicatesQuery.data]
  );

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows
      .filter((row) =>
        !term
          ? true
          : [row.fullName, row.memberId, row.phone, row.agentName, row.agentId, row.duplicateReason]
              .some((value) => String(value || "").toLowerCase().includes(term))
      )
      .sort((a, b) => {
        const delta = new Date(createdAt(a)).getTime() - new Date(createdAt(b)).getTime();
        return sort === "oldest" ? delta : -delta;
      });
  }, [rows, search, sort]);

  return (
    <div>
      <SectionHeader title="Check duplicates" subtitle="Admin and RTM duplicate review queue" />
      {!canReview ? (
        <EmptyState title="Duplicate review is restricted" hint="Only Admin and RTM reviewers can open this queue." />
      ) : (
        <>
          <div className={styles.stats}>
            <StatTile value={rows.length} label="Pending duplicates" accent />
            <StatTile value={visibleRows.length} label="Visible results" />
          </div>
          <Card>
            <div className={styles.toolbar}>
              <input type="search" aria-label="Search duplicates" placeholder="Search member, phone, agent, or reason" value={search} onChange={(event) => setSearch(event.target.value)} />
              <select aria-label="Sort duplicates" value={sort} onChange={(event) => setSort(event.target.value as "newest" | "oldest")}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </div>

            {duplicatesQuery.isLoading && <Skeleton />}
            {duplicatesQuery.error && <QueryErrorCard error={duplicatesQuery.error} pageName="duplicate checks" onRetry={() => duplicatesQuery.refetch()} />}
            {!duplicatesQuery.isLoading && !duplicatesQuery.error && visibleRows.length === 0 && (
              <EmptyState title={rows.length ? "No duplicates match your search" : "No duplicates to review"} hint={rows.length ? "Try a different member, phone, or agent." : "New duplicate checks will appear here."} />
            )}
            {!duplicatesQuery.isLoading && !duplicatesQuery.error && visibleRows.length > 0 && (
              <div className={styles.tableWrap}>
                <table>
                  <thead><tr><th>Created</th><th>Agent</th><th>Member</th><th>DOB</th><th>Phone</th><th>Match</th><th>Review</th></tr></thead>
                  <tbody>
                    {visibleRows.map((row) => (
                      <tr key={row.id}>
                        <td>{createdAt(row) ? new Date(createdAt(row)).toLocaleString() : "—"}</td>
                        <td>{row.agentName || row.agentId || "—"}</td>
                        <td><strong>{row.fullName || "—"}</strong><small>{row.memberId || ""}</small></td>
                        <td>{row.dob ? new Date(row.dob).toLocaleDateString() : "—"}</td>
                        <td>{row.phone || "—"}</td>
                        <td><span className={styles.duplicatePill}>Duplicate</span><small>{row.duplicateReason || (row.duplicateOfId ? `Matches ${row.duplicateOfId}` : "Review required")}</small></td>
                        <td>
                          {reviewingId === row.id ? (
                            <div className={styles.reviewControls}>
                              <select value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value as ReviewStatus)}>
                                {REVIEW_STATUSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                              </select>
                              <Button size="sm" disabled={reviewMutation.isPending} onClick={() => reviewMutation.mutate({ id: row.id, checkStatus: reviewStatus })}>
                                {reviewMutation.isPending ? "Saving…" : "Confirm"}
                              </Button>
                              <Button size="sm" variant="ghost" disabled={reviewMutation.isPending} onClick={() => setReviewingId(null)}>Cancel</Button>
                            </div>
                          ) : (
                            <div className={styles.reviewControls}>
                              <Button size="sm" variant="secondary" onClick={() => { setReviewingId(row.id); setReviewStatus("q"); }}>Review</Button>
                              <Button size="sm" variant="danger" disabled={deleteMutation.isPending} onClick={() => window.confirm("Permanently delete this duplicate check?") && deleteMutation.mutate(row.id)}>Delete</Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {(reviewMutation.error || deleteMutation.error) && (
              <p className={styles.error}>{((reviewMutation.error || deleteMutation.error) as Error).message}</p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
