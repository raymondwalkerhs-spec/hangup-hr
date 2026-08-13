import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useAuth } from "@/app/AuthProvider";
import { Navigate } from "react-router-dom";
import { SectionHeader } from "@/ui/SectionHeader";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { FormField, FormGrid } from "@/ui/FormGrid";

const FOLDER_KEY = "hr_backup_output_dir";

type Job = {
  id: string;
  status: string;
  progress?: { message?: string; percent?: number };
  result?: { path?: string; filesWritten?: number };
  error?: string;
};

export function BackupPage() {
  const { user } = useAuth();
  const role = String(user?.role || "").toLowerCase();
  const allowed = ["admin", "rtm"].includes(role);
  const [outputDir, setOutputDir] = useState(() => localStorage.getItem(FOLDER_KEY) || "");
  const [salesFrom, setSalesFrom] = useState("");
  const [salesTo, setSalesTo] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  const { data: me } = useQuery({
    queryKey: ["backup-me"],
    queryFn: () => api<{ username?: string; role?: string }>("/backup/me"),
    enabled: allowed,
    retry: false,
  });

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const pollJob = (jobId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await api<{ job: Job }>(`/backup/jobs/${encodeURIComponent(jobId)}`);
        setJob(res.job);
        if (res.job.status === "completed" || res.job.status === "failed") {
          clearInterval(pollRef.current);
        }
      } catch {
        clearInterval(pollRef.current);
      }
    }, 1500);
  };

  const startBackup = useMutation({
    mutationFn: (kind: "full" | "sales") => {
      if (!outputDir.trim()) throw new Error("Choose a backup folder first.");
      localStorage.setItem(FOLDER_KEY, outputDir.trim());
      const body: Record<string, string> = { outputDir: outputDir.trim() };
      if (kind === "sales") {
        if (salesFrom) body.from = salesFrom;
        if (salesTo) body.to = salesTo;
      }
      return api<{ jobId: string }>(`/backup/${kind}`, { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: (res) => {
      setJob({ id: res.jobId, status: "queued" });
      pollJob(res.jobId);
    },
  });

  async function pickFolder() {
    const hrDesktop = (window as { hrDesktop?: { pickFolder?: () => Promise<string> } }).hrDesktop;
    if (hrDesktop?.pickFolder) {
      const dir = await hrDesktop.pickFolder();
      if (dir) setOutputDir(dir);
      return;
    }
    const dir = window.prompt("Enter full path to backup folder:");
    if (dir) setOutputDir(dir);
  }

  if (!allowed) return <Navigate to="/dashboard" replace />;

  return (
    <div>
      <SectionHeader
        title="Backup & export"
        subtitle={me?.username ? `Signed in as ${me.username} (${me.role})` : "Supabase data and sales attachments"}
      />
      <Card>
        <FormGrid wide>
          <FormField label="Output folder (absolute path)" span="full">
            <div style={{ display: "flex", gap: "0.35rem" }}>
              <input value={outputDir} onChange={(e) => setOutputDir(e.target.value)} style={{ flex: 1 }} placeholder="C:\Backups\Hangup" />
              <Button type="button" variant="secondary" onClick={pickFolder}>Browse…</Button>
            </div>
          </FormField>
        </FormGrid>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "1rem" }}>
          <Button onClick={() => startBackup.mutate("full")} disabled={startBackup.isPending}>Full database backup</Button>
          <Button variant="secondary" onClick={() => startBackup.mutate("sales")} disabled={startBackup.isPending}>Sales attachments backup</Button>
        </div>
        <div style={{ marginTop: "1rem" }}>
          <FormGrid>
            <FormField label="Sales from (optional)"><input type="date" value={salesFrom} onChange={(e) => setSalesFrom(e.target.value)} /></FormField>
            <FormField label="Sales to (optional)"><input type="date" value={salesTo} onChange={(e) => setSalesTo(e.target.value)} /></FormField>
          </FormGrid>
        </div>
        {startBackup.isError && <p style={{ color: "var(--err)", marginTop: "0.75rem" }}>{(startBackup.error as Error).message}</p>}
        {job && (
          <div style={{ marginTop: "1rem", padding: "0.75rem", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
            <strong>Job {job.id}</strong> — {job.status}
            {job.progress?.message && <p className="muted">{job.progress.message}</p>}
            {job.status === "completed" && job.result && (
              <p className="muted">Wrote {job.result.filesWritten ?? "—"} file(s) to {job.result.path}</p>
            )}
            {job.status === "failed" && <p style={{ color: "var(--err)" }}>{job.error}</p>}
          </div>
        )}
        <p className="muted" style={{ marginTop: "1rem", fontSize: "0.85rem" }}>
          Also available as a standalone app: <code>npm run backup</code>
        </p>
      </Card>
    </div>
  );
}
