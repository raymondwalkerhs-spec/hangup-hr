import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

const UNDO_MS = 6000;

export function scheduleUndoDelete(commit: () => Promise<unknown> | unknown, message = "Deleted") {
  let cancelled = false;
  toast(message, {
    duration: UNDO_MS,
    action: {
      label: "Undo",
      onClick: () => {
        cancelled = true;
      },
    },
  });
  window.setTimeout(async () => {
    if (cancelled) return;
    try {
      await commit();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete");
    }
  }, UNDO_MS);
}

export function useConfirmUndo() {
  const [cfg, setCfg] = useState<{
    title: string;
    message?: string;
    toast?: string;
    commit: () => Promise<unknown> | unknown;
  } | null>(null);

  const confirmUndo = useCallback(
    (next: {
      title: string;
      message?: string;
      toast?: string;
      commit: () => Promise<unknown> | unknown;
    }) => setCfg(next),
    []
  );

  return {
    confirmUndo,
    confirmOpen: Boolean(cfg),
    setConfirmOpen: (open: boolean) => {
      if (!open) setCfg(null);
    },
    confirmTitle: cfg?.title || "",
    confirmMessage: cfg?.message || "You can undo for 6 seconds.",
    confirmDelete: () => {
      const current = cfg;
      setCfg(null);
      if (current) scheduleUndoDelete(current.commit, current.toast || "Deleted");
    },
  };
}

export function useDeferredDelete<T extends { id: string }>(opts: {
  items: T[];
  commit: (id: string) => Promise<unknown> | unknown;
  onHiddenChange?: (hiddenIds: Set<string>) => void;
  message?: string;
}) {
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pending = useRef(new Set<string>());

  const setHidden = useCallback(
    (next: Set<string>) => {
      setHiddenIds(next);
      opts.onHiddenChange?.(next);
    },
    [opts]
  );

  const visibleItems = opts.items.filter((item) => !hiddenIds.has(item.id));

  const cancel = useCallback(
    (id: string) => {
      const t = timers.current.get(id);
      if (t) clearTimeout(t);
      timers.current.delete(id);
      pending.current.delete(id);
      setHidden((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    },
    [setHidden]
  );

  const commitLater = useCallback(
    (id: string) => {
      pending.current.add(id);
      setHidden((prev) => new Set(prev).add(id));
      toast(opts.message || "Deleted", {
        duration: UNDO_MS,
        action: {
          label: "Undo",
          onClick: () => cancel(id),
        },
      });
      const t = setTimeout(async () => {
        timers.current.delete(id);
        if (!pending.current.has(id)) return;
        pending.current.delete(id);
        try {
          await opts.commit(id);
        } catch (err) {
          cancel(id);
          toast.error(err instanceof Error ? err.message : "Could not delete");
        }
      }, UNDO_MS);
      timers.current.set(id, t);
    },
    [cancel, opts, setHidden]
  );

  const requestDelete = useCallback((id: string) => {
    setConfirmId(id);
  }, []);

  const confirmDelete = useCallback(() => {
    if (!confirmId) return;
    const id = confirmId;
    setConfirmId(null);
    commitLater(id);
  }, [confirmId, commitLater]);

  return {
    visibleItems,
    hiddenIds,
    confirmId,
    setConfirmId,
    requestDelete,
    confirmDelete,
    cancel,
  };
}
