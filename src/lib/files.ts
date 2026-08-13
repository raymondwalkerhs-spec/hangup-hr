import { getSessionId } from "@/api/client";

/** ~37 MB raw file fits in 50 MB JSON body after base64 (+33%). */
export const MAX_SALE_ATTACHMENT_BYTES = 35 * 1024 * 1024;

const AUDIO_EXT = /\.(mp3|wav|m4a|ogg|aac|opus|flac|wma|amr)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|mpeg|mpg|3gp|m4v)$/i;

export function isAudioFileName(name: string): boolean {
  return AUDIO_EXT.test(String(name || ""));
}

export function isVideoFileName(name: string): boolean {
  return VIDEO_EXT.test(String(name || ""));
}

export function isInlineMediaFileName(name: string): boolean {
  return isAudioFileName(name) || isVideoFileName(name);
}

export function mediaMimeFromFileName(name: string): string {
  const ext = String(name || "").toLowerCase().match(/\.[^.]+$/)?.[0] || "";
  const map: Record<string, string> = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".ogg": "audio/ogg",
    ".opus": "audio/opus",
    ".flac": "audio/flac",
    ".wma": "audio/x-ms-wma",
    ".amr": "audio/amr",
    ".webm": "video/webm",
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".mov": "video/quicktime",
    ".mpeg": "video/mpeg",
    ".mpg": "video/mpeg",
    ".3gp": "video/3gpp",
  };
  return map[ext] || "application/octet-stream";
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function fetchApiBlob(path: string): Promise<{ blob: Blob; mime: string }> {
  const sessionId = getSessionId();
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    headers: sessionId ? { "x-session-id": sessionId } : {},
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || "Download failed");
  }
  const blob = await res.blob();
  const mime = res.headers.get("Content-Type") || blob.type || "application/octet-stream";
  return { blob, mime };
}

export async function downloadApiFile(path: string, filename: string) {
  const sessionId = getSessionId();
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    headers: sessionId ? { "x-session-id": sessionId } : {},
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || "Download failed");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function shiftMonth(ym: string, delta: number): string {
  if (!/^\d{4}-\d{2}$/.test(ym)) return ym;
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
