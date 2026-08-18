function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const ct = String(req.headers["content-type"] || "");
    const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct);
    const boundary = (m && (m[1] || m[2]) || "").trim();
    if (!boundary) {
      reject(new Error("multipart boundary missing"));
      return;
    }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("error", reject);
    req.on("end", () => {
      const buf = Buffer.concat(chunks);
      const sep = Buffer.from(`--${boundary}`);
      const parts = [];
      let start = buf.indexOf(sep);
      while (start !== -1) {
        const next = buf.indexOf(sep, start + sep.length);
        const slice = buf.slice(start + sep.length, next === -1 ? buf.length : next);
        if (slice.length > 4) parts.push(slice);
        start = next;
      }
      const fields = {};
      let file = null;
      for (const part of parts) {
        const headerEnd = part.indexOf("\r\n\r\n");
        if (headerEnd < 0) continue;
        const header = part.slice(0, headerEnd).toString("utf8");
        let body = part.slice(headerEnd + 4);
        if (body.slice(-2).toString() === "\r\n") body = body.slice(0, -2);
        const nameM = /name="([^"]+)"/i.exec(header);
        const fileM = /filename="([^"]*)"/i.exec(header);
        if (!nameM) continue;
        if (fileM) {
          file = { field: nameM[1], fileName: fileM[1] || "file", buffer: body };
        } else {
          fields[nameM[1]] = body.toString("utf8");
        }
      }
      resolve({ fields, file });
    });
  });
}

async function readUploadBuffer(req, { assertSize } = {}) {
  const ct = String(req.headers["content-type"] || "");
  if (ct.includes("multipart/form-data")) {
    const parsed = await parseMultipart(req);
    const fileName = parsed.fields.fileName || parsed.file?.fileName;
    const kind = parsed.fields.kind;
    const buffer = parsed.file?.buffer;
    if (!buffer || !fileName) return { ok: false, error: "fileName and file required", fields: parsed.fields };
    if (assertSize) {
      const check = assertSize(buffer);
      if (!check.ok) return { ...check, fields: parsed.fields };
    }
    return { ok: true, fileName, kind, buffer, fields: parsed.fields };
  }
  const { fileName, contentBase64, kind } = req.body || {};
  if (!contentBase64 || !fileName) return { ok: false, error: "fileName and contentBase64 required", fields: {} };
  if (assertSize) return { ...assertSize(contentBase64), fileName, kind, fields: {} };
  const buffer = Buffer.from(String(contentBase64).replace(/^data:[^;]+;base64,/, ""), "base64");
  return { ok: true, fileName, kind, buffer, fields: {} };
}

module.exports = { parseMultipart, readUploadBuffer };
