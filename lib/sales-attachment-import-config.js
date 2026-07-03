/**
 * CSV column → sales_attachments.kind mapping for import scripts.
 * Headers are matched with norm().includes() so minor CSV renames still work.
 */
const { norm } = require("./sales-import-helpers");
const { parseAttachmentCell } = require("./airtable-attachment-parser");

const CSV_ATTACHMENT_COLUMNS = [
  { headerMatch: "Recordings", kind: "recording" },
  { headerMatch: "Raw call record", kind: "raw_call" },
  { headerMatch: "Quality Record", kind: "quality_record" },
  { headerMatch: "Receipt Attachment", kind: "receipt" },
  { headerMatch: "Confirmation", kind: "confirmation" },
];

function resolveAttachColumns(headers) {
  return CSV_ATTACHMENT_COLUMNS.filter(({ headerMatch }) =>
    headers.some((h) => norm(h).includes(norm(headerMatch)))
  );
}

function colIndex(headers, name) {
  const i = headers.findIndex((h) => norm(h).includes(norm(name)));
  return i >= 0 ? i : -1;
}

function parseAttachmentsFromRow(headers, row) {
  const attachments = [];
  for (const { headerMatch, kind } of resolveAttachColumns(headers)) {
    const i = colIndex(headers, headerMatch);
    if (i < 0) continue;
    const cell = row[i] || "";
    for (const att of parseAttachmentCell(cell)) {
      attachments.push({ ...att, kind });
    }
  }
  return attachments;
}

function attachmentDedupKey(saleId, att) {
  return `${saleId}|${att.kind}|${att.fileName}`;
}

module.exports = {
  CSV_ATTACHMENT_COLUMNS,
  resolveAttachColumns,
  parseAttachmentsFromRow,
  attachmentDedupKey,
};
