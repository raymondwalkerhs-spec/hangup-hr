import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { useAppStatus } from "@/hooks/useAppStatus";
import { SectionHeader } from "@/ui/SectionHeader";
import { Button } from "@/ui/Button";
import { Dialog, ConfirmDialog } from "@/ui/Dialog";
import { Dropzone } from "@/ui/Dropzone";
import { useDeferredDelete } from "@/ui/useDeferredDelete";
import { fetchApiBlob, isAudioFileName, MAX_SALE_ATTACHMENT_BYTES } from "@/lib/files";
import { uploadWithProgress } from "@/lib/uploadWithProgress";
import { RichTextEditor } from "./RichTextEditor";
import styles from "./AnnouncementsPage.module.css";

type ImagePlacement = "top" | "middle" | "bottom";

type AnnouncementListItem = {
  id: string;
  title: string;
  hasImage?: boolean;
  hasAudio?: boolean;
  imagePlacement?: ImagePlacement;
  companyWide?: boolean;
  audienceUnits?: string[];
  audienceTeams?: string[];
  audienceRoles?: string[];
  audienceSummary?: string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
  unread?: boolean;
};

type Announcement = AnnouncementListItem & {
  bodyHtml?: string;
  imageName?: string;
  audioName?: string;
};

type AudienceOptions = {
  units?: string[];
  teams?: string[];
  roles?: { id: string; label: string }[];
  imagePlacements?: { id: ImagePlacement; label: string }[];
};

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const PLACEMENT_LABELS: Record<ImagePlacement, string> = {
  top: "Above the text",
  middle: "In the middle of the text",
  bottom: "Below the text",
};

function formatWhen(value?: string) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function toggleValue(list: string[], value: string) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function splitBodyHtml(html: string) {
  const s = html || "";
  const tokens = s.split(/(<\/p>)/i);
  if (tokens.length < 3) return { before: s, after: "" };
  let cut = Math.ceil(tokens.length / 2);
  while (cut < tokens.length && !/^<\/p>$/i.test(tokens[cut] || "")) cut += 1;
  if (cut >= tokens.length) cut = Math.ceil(tokens.length / 2);
  return {
    before: tokens.slice(0, cut + 1).join(""),
    after: tokens.slice(cut + 1).join(""),
  };
}

function AuthoredMedia({
  kind,
  id,
  pathFn,
  imageName,
  audioName,
}: {
  kind: "image" | "audio";
  id: string;
  pathFn: (p: string) => string;
  imageName?: string;
  audioName?: string;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let revoke = "";
    let cancelled = false;
    (async () => {
      try {
        const { blob } = await fetchApiBlob(pathFn(`/announcements/${id}/${kind}`));
        if (cancelled) return;
        revoke = URL.createObjectURL(blob);
        setUrl(revoke);
      } catch (err) {
        if (!cancelled) setError((err as Error).message || "Failed to load media");
      }
    })();
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [id, kind, pathFn]);

  if (error) return <p className="muted">{error}</p>;
  if (!url) return <p className="muted">Loading {kind}…</p>;
  if (kind === "image") {
    return <img className={styles.heroImg} src={url} alt={imageName || "Announcement"} />;
  }
  return <audio className={styles.audio} src={url} controls preload="metadata" title={audioName || "Audio"} />;
}

function AnnouncementBody({
  detail,
  selectedId,
  pathFn,
}: {
  detail: Announcement;
  selectedId: string;
  pathFn: (p: string) => string;
}) {
  const image = detail.hasImage ? (
    <AuthoredMedia kind="image" id={selectedId} pathFn={pathFn} imageName={detail.imageName} />
  ) : null;
  const placement = detail.imagePlacement || "top";
  const { before, after } = splitBodyHtml(detail.bodyHtml || "");
  return (
    <>
      {placement === "top" && image}
      {placement === "middle" ? (
        <>
          <div className={styles.bodyHtml} dangerouslySetInnerHTML={{ __html: before }} />
          {image}
          {after ? <div className={styles.bodyHtml} dangerouslySetInnerHTML={{ __html: after }} /> : null}
        </>
      ) : (
        <div className={styles.bodyHtml} dangerouslySetInnerHTML={{ __html: detail.bodyHtml || "" }} />
      )}
      {placement === "bottom" && image}
    </>
  );
}

export function AnnouncementsPage() {
  const qc = useQueryClient();
  const { path, companyContext } = useCompanyScope();
  const { user } = useAppStatus();
  const canEdit = user?.canEditAnnouncements === true;
  const [searchParams, setSearchParams] = useSearchParams();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [companyWide, setCompanyWide] = useState(true);
  const [audienceUnits, setAudienceUnits] = useState<string[]>([]);
  const [audienceTeams, setAudienceTeams] = useState<string[]>([]);
  const [audienceRoles, setAudienceRoles] = useState<string[]>([]);
  const [imagePlacement, setImagePlacement] = useState<ImagePlacement>("top");
  const [formError, setFormError] = useState("");
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [pendingImageUrl, setPendingImageUrl] = useState("");
  const [pendingAudio, setPendingAudio] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [removeAudio, setRemoveAudio] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["announcements", companyContext],
    queryFn: () => api<{ announcements?: AnnouncementListItem[] }>(path("/announcements")),
  });

  const { data: detailData, isLoading: detailLoading } = useQuery({
    queryKey: ["announcement", selectedId, companyContext],
    queryFn: () => api<{ announcement?: Announcement }>(path(`/announcements/${selectedId}`)),
    enabled: Boolean(selectedId),
  });

  const { data: options } = useQuery({
    queryKey: ["announcement-options", companyContext],
    queryFn: () => api<AudienceOptions>(path("/announcements/options")),
    enabled: canEdit,
  });

  const items = data?.announcements || [];
  const detail = detailData?.announcement;
  const deferred = useDeferredDelete({
    items,
    commit: async (id) => {
      await api(path(`/announcements/${id}`), { method: "DELETE" });
      qc.invalidateQueries({ queryKey: ["announcements"] });
      qc.invalidateQueries({ queryKey: ["announcement-unread"] });
      qc.invalidateQueries({ queryKey: ["hrms-notifications"] });
      if (selectedId === id) setSelectedId(null);
    },
    message: "Announcement deleted",
  });

  useEffect(() => {
    const openId = searchParams.get("open");
    if (!openId) return;
    setSelectedId(openId);
    const next = new URLSearchParams(searchParams);
    next.delete("open");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    (async () => {
      try {
        await api(path(`/announcements/${selectedId}/read`), { method: "POST", body: "{}" });
        if (cancelled) return;
        qc.invalidateQueries({ queryKey: ["announcement-unread"] });
        qc.invalidateQueries({ queryKey: ["announcements"] });
        qc.invalidateQueries({ queryKey: ["hrms-notifications"] });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, path, qc]);

  const save = useMutation({
    mutationFn: async () => {
      if (!companyWide && !audienceUnits.length && !audienceTeams.length && !audienceRoles.length) {
        throw new Error("Choose at least one unit, team, or role, or pick whole company");
      }
      const payload = {
        title: title.trim(),
        bodyHtml,
        companyWide,
        audienceUnits: companyWide ? [] : audienceUnits,
        audienceTeams: companyWide ? [] : audienceTeams,
        audienceRoles: companyWide ? [] : audienceRoles,
        imagePlacement,
      };
      let id = editingId;
      if (editingId) {
        await api(path(`/announcements/${editingId}`), { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        const created = await api<{ announcement?: Announcement }>(path("/announcements"), {
          method: "POST",
          body: JSON.stringify(payload),
        });
        id = created.announcement?.id || null;
      }
      if (!id) throw new Error("Save failed");
      if (removeImage) {
        await api(path(`/announcements/${id}/image`), { method: "DELETE" });
      }
      if (removeAudio) {
        await api(path(`/announcements/${id}/audio`), { method: "DELETE" });
      }
      if (pendingImage) {
        if (pendingImage.size > MAX_IMAGE_BYTES) throw new Error("Image must be 8 MB or smaller");
        await uploadWithProgress({
          url: `/api${path(`/announcements/${id}/image`)}`,
          file: pendingImage,
        });
      }
      if (pendingAudio) {
        if (pendingAudio.size > MAX_SALE_ATTACHMENT_BYTES) throw new Error("Audio must be 35 MB or smaller");
        await uploadWithProgress({
          url: `/api${path(`/announcements/${id}/audio`)}`,
          file: pendingAudio,
        });
      }
      return id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["announcements"] });
      qc.invalidateQueries({ queryKey: ["announcement", id] });
      qc.invalidateQueries({ queryKey: ["announcement-unread"] });
      qc.invalidateQueries({ queryKey: ["hrms-notifications"] });
      setEditorOpen(false);
      setSelectedId(id);
      setFormError("");
    },
    onError: (err: Error) => setFormError(err.message || "Save failed"),
  });


  const resetMedia = () => {
    setPendingImage(null);
    setPendingImageUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return "";
    });
    setPendingAudio(null);
    setRemoveImage(false);
    setRemoveAudio(false);
  };

  const openNew = () => {
    setEditingId(null);
    setTitle("");
    setBodyHtml("");
    setCompanyWide(true);
    setAudienceUnits([]);
    setAudienceTeams([]);
    setAudienceRoles([]);
    setImagePlacement("top");
    resetMedia();
    setFormError("");
    setEditorOpen(true);
  };

  const openEdit = (row: Announcement) => {
    setEditingId(row.id);
    setTitle(row.title || "");
    setBodyHtml(row.bodyHtml || "");
    const wide = row.companyWide !== false && !(row.audienceUnits || []).length && !(row.audienceTeams || []).length && !(row.audienceRoles || []).length;
    setCompanyWide(wide);
    setAudienceUnits(row.audienceUnits || []);
    setAudienceTeams(row.audienceTeams || []);
    setAudienceRoles(row.audienceRoles || []);
    setImagePlacement(row.imagePlacement || "top");
    resetMedia();
    setFormError("");
    setEditorOpen(true);
  };

  return (
    <div>
      <SectionHeader
        title="Announcements"
        subtitle="Whole company, or targeted by unit, team, and role"
        actions={canEdit ? <Button onClick={openNew}>+ New announcement</Button> : undefined}
      />

      {isLoading && <p className="muted">Loading…</p>}
      {error && <p style={{ color: "var(--err)" }}>{(error as Error).message}</p>}
      {!isLoading && !deferred.visibleItems.length && <p className="muted">No announcements yet.</p>}

      <div className={styles.list}>
        {deferred.visibleItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`${styles.row} ${item.unread ? styles.rowUnread : ""}`}
            onClick={() => setSelectedId(item.id)}
          >
            <div>
              <p className={styles.rowTitle}>
                {item.unread ? <span className={styles.unreadDot} aria-hidden /> : null}
                {item.title}
              </p>
              <span className={styles.scopeBadge}>{item.audienceSummary || "Whole company"}</span>
            </div>
            <span className={styles.rowMeta}>{formatWhen(item.createdAt)}</span>
          </button>
        ))}
      </div>

      <Dialog
        open={Boolean(selectedId)}
        onOpenChange={(open) => !open && setSelectedId(null)}
        title={detail?.title || "Announcement"}
        wide
        footer={
          canEdit && detail ? (
            <div className={styles.actions}>
              <Button variant="secondary" onClick={() => openEdit(detail)}>Edit</Button>
              <Button variant="danger" onClick={() => detail.id && deferred.requestDelete(detail.id)}>Delete</Button>
            </div>
          ) : undefined
        }
      >
        {detailLoading && <p className="muted">Loading…</p>}
        {detail && selectedId && (
          <div className={styles.detail}>
            <p className="muted" style={{ margin: 0 }}>
              {formatWhen(detail.updatedAt || detail.createdAt)}
              {detail.createdBy ? ` · ${detail.createdBy}` : ""}
              {detail.audienceSummary ? ` · ${detail.audienceSummary}` : ""}
            </p>
            <AnnouncementBody detail={detail} selectedId={selectedId} pathFn={path} />
            {detail.hasAudio && (
              <AuthoredMedia kind="audio" id={selectedId} pathFn={path} audioName={detail.audioName} />
            )}
          </div>
        )}
      </Dialog>

      <Dialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        title={editingId ? "Edit announcement" : "New announcement"}
        wide
        footer={
          <div className={styles.actions}>
            <Button variant="secondary" onClick={() => setEditorOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || !title.trim()}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        }
      >
        <div className={styles.form}>
          {formError && <p style={{ color: "var(--err)" }}>{formError}</p>}
          <label>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </label>
          <fieldset className={styles.fieldset}>
            <legend>Who receives this</legend>
            <label className={styles.radioRow}>
              <input type="radio" checked={companyWide} onChange={() => setCompanyWide(true)} />
              Whole company (current workspace)
            </label>
            <label className={styles.radioRow}>
              <input type="radio" checked={!companyWide} onChange={() => setCompanyWide(false)} />
              Targeted audience
            </label>
            {!companyWide && (
              <p className="muted" style={{ margin: 0 }}>
                Recipients must match every selected filter (unit, team, and role). Leave a filter empty to ignore it.
              </p>
            )}
            {!companyWide && (
              <div className={styles.audienceGrid}>
                <div>
                  <strong>Units</strong>
                  <div className={styles.checkGrid}>
                    {(options?.units || []).map((unit) => (
                      <label key={unit} className={styles.checkRow}>
                        <input
                          type="checkbox"
                          checked={audienceUnits.includes(unit)}
                          onChange={() => setAudienceUnits((prev) => toggleValue(prev, unit))}
                        />
                        {unit}
                      </label>
                    ))}
                    {!options?.units?.length && <p className="muted">No units found</p>}
                  </div>
                </div>
                <div>
                  <strong>Teams</strong>
                  <div className={styles.checkGrid}>
                    {(options?.teams || []).map((team) => (
                      <label key={team} className={styles.checkRow}>
                        <input
                          type="checkbox"
                          checked={audienceTeams.includes(team)}
                          onChange={() => setAudienceTeams((prev) => toggleValue(prev, team))}
                        />
                        {team}
                      </label>
                    ))}
                    {!options?.teams?.length && <p className="muted">No teams found</p>}
                  </div>
                </div>
                <div>
                  <strong>Roles</strong>
                  <div className={styles.checkGrid}>
                    {(options?.roles || []).map((role) => (
                      <label key={role.id} className={styles.checkRow}>
                        <input
                          type="checkbox"
                          checked={audienceRoles.includes(role.id)}
                          onChange={() => setAudienceRoles((prev) => toggleValue(prev, role.id))}
                        />
                        {role.label}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </fieldset>
          <label>
            Body
            <RichTextEditor value={bodyHtml} onChange={setBodyHtml} />
          </label>
          <div className={styles.mediaSlot}>
            <strong>Picture</strong>
            <fieldset className={styles.fieldset}>
              <legend>Picture placement</legend>
              {(options?.imagePlacements || [
                { id: "top" as const, label: PLACEMENT_LABELS.top },
                { id: "middle" as const, label: PLACEMENT_LABELS.middle },
                { id: "bottom" as const, label: PLACEMENT_LABELS.bottom },
              ]).map((opt) => (
                <label key={opt.id} className={styles.radioRow}>
                  <input
                    type="radio"
                    checked={imagePlacement === opt.id}
                    onChange={() => setImagePlacement(opt.id)}
                  />
                  {opt.label}
                </label>
              ))}
            </fieldset>
            {!removeImage && (pendingImage || (editingId && detail?.hasImage && editingId === detail.id)) && (
              pendingImageUrl ? (
                <img className={styles.previewImg} src={pendingImageUrl} alt="" />
              ) : editingId ? (
                <AuthoredMedia kind="image" id={editingId} pathFn={path} />
              ) : null
            )}
            <div className={styles.mediaActions}>
              <Dropzone
                label="Drop a picture or click to browse"
                accept="image/*"
                maxBytes={MAX_IMAGE_BYTES}
                onFile={(f) => {
                  setPendingImage(f);
                  setPendingImageUrl((prev) => {
                    if (prev) URL.revokeObjectURL(prev);
                    return URL.createObjectURL(f);
                  });
                  setRemoveImage(false);
                }}
              />
              {(pendingImage || (editingId && detail?.hasImage)) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPendingImage(null);
                    setPendingImageUrl((prev) => {
                      if (prev) URL.revokeObjectURL(prev);
                      return "";
                    });
                    setRemoveImage(true);
                  }}
                >
                  Remove picture
                </Button>
              )}
            </div>
          </div>
          <div className={styles.mediaSlot}>
            <strong>Audio (optional)</strong>
            {!removeAudio && pendingAudio && <p className="muted">{pendingAudio.name}</p>}
            {!removeAudio && !pendingAudio && editingId && detail?.hasAudio && editingId === detail.id && (
              <AuthoredMedia kind="audio" id={editingId} pathFn={path} audioName={detail.audioName} />
            )}
            <div className={styles.mediaActions}>
              <Dropzone
                label="Drop audio or click to browse"
                accept="audio/*,.mp3,.wav,.m4a,.ogg,.aac,.opus,.amr"
                maxBytes={MAX_SALE_ATTACHMENT_BYTES}
                onFile={(f) => {
                  if (!isAudioFileName(f.name) && !String(f.type || "").startsWith("audio/")) {
                    setFormError("Choose an audio file");
                    return;
                  }
                  setPendingAudio(f);
                  setRemoveAudio(false);
                }}
              />
              {(pendingAudio || (editingId && detail?.hasAudio)) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPendingAudio(null);
                    setRemoveAudio(true);
                  }}
                >
                  Remove audio
                </Button>
              )}
            </div>
          </div>
        </div>
      </Dialog>
      <ConfirmDialog
        open={Boolean(deferred.confirmId)}
        onOpenChange={(o) => !o && deferred.setConfirmId(null)}
        title="Delete announcement?"
        message="It will move to the recycle bin for 20 days. You can undo for 6 seconds."
        danger
        onConfirm={deferred.confirmDelete}
      />
    </div>
  );
}
