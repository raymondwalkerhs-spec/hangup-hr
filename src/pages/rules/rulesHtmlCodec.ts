export type TableCell = { text: string; colspan?: number };

export type RulesTableBlock = {
  type: "table";
  headers: string[];
  rows: TableCell[][];
  hasHeader: boolean;
};

export type RulesNoteBlock = { type: "note"; text: string };
export type RulesListBlock = { type: "list"; ordered: boolean; items: string[] };
export type RulesHtmlBlock = { type: "html"; html: string };

export type RulesBlock = RulesTableBlock | RulesNoteBlock | RulesListBlock | RulesHtmlBlock;

function cellText(el: Element) {
  return (el.textContent || "").replace(/\s+/g, " ").trim();
}

function parseCells(row: Element): TableCell[] {
  return Array.from(row.children).map((cell) => {
    const colspan = Number((cell as HTMLTableCellElement).getAttribute("colspan") || 1);
    return {
      text: cellText(cell),
      colspan: colspan > 1 ? colspan : undefined,
    };
  });
}

function parseTable(table: HTMLTableElement): RulesTableBlock {
  const headers: string[] = [];
  const rows: TableCell[][] = [];
  let hasHeader = false;

  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");
  const bodyRows = tbody
    ? Array.from(tbody.querySelectorAll(":scope > tr"))
    : Array.from(table.querySelectorAll(":scope > tr"));

  if (thead) {
    hasHeader = true;
    const headerRow = thead.querySelector("tr");
    if (headerRow) headers.push(...parseCells(headerRow).map((c) => c.text));
    for (const row of bodyRows) rows.push(parseCells(row));
  } else if (bodyRows.length && bodyRows[0].querySelector("th")) {
    hasHeader = true;
    headers.push(...parseCells(bodyRows[0]).map((c) => c.text));
    for (const row of bodyRows.slice(1)) rows.push(parseCells(row));
  } else {
    for (const row of bodyRows) rows.push(parseCells(row));
  }

  const colCount = Math.max(
    headers.length,
    ...rows.map((r) => r.reduce((n, c) => n + (c.colspan || 1), 0)),
    1,
  );

  const normalizeRow = (cells: TableCell[]) => {
    const out = [...cells];
    while (out.reduce((n, c) => n + (c.colspan || 1), 0) < colCount) {
      out.push({ text: "" });
    }
    return out;
  };

  return {
    type: "table",
    headers: hasHeader ? normalizeRow(headers.map((t) => ({ text: t }))).map((c) => c.text) : [],
    rows: rows.map(normalizeRow),
    hasHeader,
  };
}

export function parseRulesHtml(html: string): RulesBlock[] {
  const trimmed = (html || "").trim();
  if (!trimmed) return [];

  const doc = new DOMParser().parseFromString(`<div id="rules-root">${trimmed}</div>`, "text/html");
  const root = doc.getElementById("rules-root");
  if (!root) return [{ type: "html", html: trimmed }];

  const blocks: RulesBlock[] = [];
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent || "").trim();
      if (text) blocks.push({ type: "html", html: text });
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as HTMLElement;

    if (el.tagName === "DIV" && el.classList.contains("info-note")) {
      blocks.push({ type: "note", text: cellText(el) });
    } else if (el.tagName === "TABLE") {
      blocks.push(parseTable(el));
    } else if (el.tagName === "UL" || el.tagName === "OL") {
      blocks.push({
        type: "list",
        ordered: el.tagName === "OL",
        items: Array.from(el.querySelectorAll(":scope > li")).map((li) => cellText(li)),
      });
    } else {
      const innerTable = el.querySelector("table");
      if (innerTable) {
        if (el.classList.contains("info-note")) {
          blocks.push({ type: "note", text: cellText(el) });
        } else {
          blocks.push(parseTable(innerTable));
        }
      } else {
        blocks.push({ type: "html", html: el.outerHTML });
      }
    }
  }

  return blocks.length ? blocks : [{ type: "html", html: trimmed }];
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function serializeCell(cell: TableCell) {
  const attrs = cell.colspan && cell.colspan > 1 ? ` colspan="${cell.colspan}"` : "";
  return `<td${attrs}>${escapeHtml(cell.text)}</td>`;
}

function serializeTable(block: RulesTableBlock) {
  const headerRow = block.hasHeader
    ? `<thead><tr>${block.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>`
    : "";
  const body = block.rows
    .map((row) => `<tr>${row.map(serializeCell).join("")}</tr>`)
    .join("\n  ");
  return `<table class="rules-table">\n  ${headerRow}${headerRow ? "\n  " : ""}<tbody>\n  ${body}\n  </tbody>\n</table>`;
}

export function serializeRulesHtml(blocks: RulesBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === "note") {
        return `<div class="info-note">${escapeHtml(block.text)}</div>`;
      }
      if (block.type === "table") {
        return serializeTable(block);
      }
      if (block.type === "list") {
        const tag = block.ordered ? "ol" : "ul";
        const items = block.items
          .filter((item) => item.trim())
          .map((item) => `  <li>${escapeHtml(item)}</li>`)
          .join("\n");
        return `<${tag}>\n${items}\n</${tag}>`;
      }
      return block.html;
    })
    .join("\n");
}

export function columnCount(block: RulesTableBlock) {
  return Math.max(
    block.hasHeader ? block.headers.length : 0,
    ...block.rows.map((r) => r.length),
    1,
  );
}

export function normalizeTable(block: RulesTableBlock): RulesTableBlock {
  const cols = columnCount(block);
  const pad = (cells: TableCell[]) => {
    const out = cells.map((c) => ({ ...c }));
    while (out.length < cols) out.push({ text: "" });
    return out.slice(0, cols);
  };
  return {
    ...block,
    headers: block.hasHeader ? pad(block.headers.map((t) => ({ text: t }))).map((c) => c.text) : [],
    rows: block.rows.map(pad),
  };
}
