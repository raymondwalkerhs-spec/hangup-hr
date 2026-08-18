import { getSessionId } from "@/api/client";

export type UploadProgress = {
  loaded: number;
  total: number;
  pct: number;
  speedBps: number;
  etaSec: number;
};

export function uploadWithProgress({
  url,
  file,
  fields,
  onProgress,
}: {
  url: string;
  file: File;
  fields?: Record<string, string>;
  onProgress?: (p: UploadProgress) => void;
}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const started = Date.now();
    xhr.open("POST", url);
    const session = getSessionId();
    if (session) xhr.setRequestHeader("x-session-id", session);
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const elapsed = Math.max(0.2, (Date.now() - started) / 1000);
      const speedBps = e.loaded / elapsed;
      const remain = Math.max(0, e.total - e.loaded);
      onProgress?.({
        loaded: e.loaded,
        total: e.total,
        pct: Math.round((e.loaded / e.total) * 100),
        speedBps,
        etaSec: speedBps > 0 ? remain / speedBps : 0,
      });
    };
    xhr.onload = () => {
      let data: unknown = {};
      try {
        data = JSON.parse(xhr.responseText || "{}");
      } catch {
        data = {};
      }
      if (xhr.status === 401) {
        window.location.href = "/login";
        reject(new Error("Unauthorized"));
        return;
      }
      if (xhr.status >= 400) {
        const msg = (data as { error?: string }).error || xhr.statusText || "Upload failed";
        reject(new Error(msg));
        return;
      }
      resolve(data);
    };
    xhr.onerror = () => reject(new Error("Connection dropped. Retry the same file."));
    const body = new FormData();
    body.append("file", file, file.name);
    body.append("fileName", file.name);
    if (fields) {
      for (const [k, v] of Object.entries(fields)) body.append(k, v);
    }
    xhr.send(body);
  });
}
