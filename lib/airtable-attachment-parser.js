/**
 * Parse Airtable export cells: "file.mp3 (https://...)" possibly multiple per cell.
 */
const ATTACHMENT_RE = /([^(\n]+?)\s*\((https?:\/\/[^)\s]+)\)/g;

function parseAttachmentCell(raw) {
  const text = String(raw || "").trim();
  if (!text) return [];
  const out = [];
  let m;
  const re = new RegExp(ATTACHMENT_RE.source, "g");
  while ((m = re.exec(text)) !== null) {
    const fileName = String(m[1] || "").trim().replace(/^["']|["']$/g, "");
    const url = String(m[2] || "").trim();
    if (fileName && url) out.push({ fileName, url });
  }
  if (!out.length && /^https?:\/\//i.test(text)) {
    const url = text.match(/https?:\/\/\S+/)?.[0] || text;
    const fileName = url.split("/").pop()?.split("?")[0] || "attachment";
    out.push({ fileName, url });
  }
  return out;
}

module.exports = { parseAttachmentCell, ATTACHMENT_RE };
