import { useMemo, useState } from "react";
import { Button } from "@/ui/Button";
import {
  type RulesBlock,
  type RulesTableBlock,
  columnCount,
  normalizeTable,
  parseRulesHtml,
  serializeRulesHtml,
} from "./rulesHtmlCodec";
import styles from "./RulesPage.module.css";

function TableBlockEditor({
  block,
  onChange,
}: {
  block: RulesTableBlock;
  onChange: (next: RulesTableBlock) => void;
}) {
  const table = useMemo(() => normalizeTable(block), [block]);
  const cols = columnCount(table);

  const setHeader = (index: number, value: string) => {
    const headers = [...table.headers];
    headers[index] = value;
    onChange({ ...table, headers });
  };

  const setCell = (rowIndex: number, colIndex: number, value: string) => {
    const rows = table.rows.map((row, ri) =>
      ri === rowIndex
        ? row.map((cell, ci) => (ci === colIndex ? { ...cell, text: value } : cell))
        : row,
    );
    onChange({ ...table, rows });
  };

  const addRow = () => {
    onChange({
      ...table,
      rows: [...table.rows, Array.from({ length: cols }, () => ({ text: "" }))],
    });
  };

  const removeRow = (rowIndex: number) => {
    onChange({ ...table, rows: table.rows.filter((_, i) => i !== rowIndex) });
  };

  const addColumn = () => {
    onChange({
      ...table,
      hasHeader: table.hasHeader || table.rows.length > 0,
      headers: table.hasHeader ? [...table.headers, ""] : table.headers,
      rows: table.rows.map((row) => [...row, { text: "" }]),
    });
  };

  const removeColumn = (colIndex: number) => {
    if (cols <= 1) return;
    onChange({
      ...table,
      headers: table.hasHeader ? table.headers.filter((_, i) => i !== colIndex) : table.headers,
      rows: table.rows.map((row) => row.filter((_, i) => i !== colIndex)),
    });
  };

  const toggleHeader = () => {
    if (table.hasHeader) {
      onChange({ ...table, hasHeader: false, headers: [] });
      return;
    }
    const headers = table.headers.length
      ? table.headers
      : Array.from({ length: cols }, (_, i) => `Column ${i + 1}`);
    onChange({ ...table, hasHeader: true, headers });
  };

  return (
    <div className={styles.tableEditor}>
      <div className={styles.tableToolbar}>
        <Button size="sm" variant="secondary" type="button" onClick={addRow}>+ Row</Button>
        <Button size="sm" variant="secondary" type="button" onClick={addColumn}>+ Column</Button>
        <Button size="sm" variant="secondary" type="button" onClick={toggleHeader}>
          {table.hasHeader ? "Hide header row" : "Add header row"}
        </Button>
      </div>
      <div className="table-wrap">
        <table className={styles.editGrid}>
          {table.hasHeader && (
            <thead>
              <tr>
                {table.headers.map((header, ci) => (
                  <th key={ci}>
                    <input
                      className={styles.cellInput}
                      value={header}
                      onChange={(e) => setHeader(ci, e.target.value)}
                      placeholder={`Column ${ci + 1}`}
                    />
                    {cols > 1 && (
                      <button
                        type="button"
                        className={styles.colRemove}
                        title="Remove column"
                        onClick={() => removeColumn(ci)}
                      >
                        ×
                      </button>
                    )}
                  </th>
                ))}
                <th className={styles.rowActionCol} aria-label="Row actions" />
              </tr>
            </thead>
          )}
          <tbody>
            {table.rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci}>
                    <input
                      className={styles.cellInput}
                      value={cell.text}
                      onChange={(e) => setCell(ri, ci, e.target.value)}
                      placeholder="—"
                    />
                  </td>
                ))}
                <td className={styles.rowActionCol}>
                  <button
                    type="button"
                    className={styles.rowRemove}
                    title="Remove row"
                    onClick={() => removeRow(ri)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!table.rows.length && (
        <p className="muted" style={{ margin: "0.5rem 0 0" }}>No rows yet — click + Row to add a rule line.</p>
      )}
    </div>
  );
}

function ListBlockEditor({
  block,
  onChange,
}: {
  block: Extract<RulesBlock, { type: "list" }>;
  onChange: (next: Extract<RulesBlock, { type: "list" }>) => void;
}) {
  const setItem = (index: number, value: string) => {
    const items = [...block.items];
    items[index] = value;
    onChange({ ...block, items });
  };

  return (
    <div className={styles.listEditor}>
      {block.items.map((item, i) => (
        <div key={i} className={styles.listRow}>
          <span className={styles.listBullet}>{block.ordered ? `${i + 1}.` : "•"}</span>
          <textarea
            className={styles.listInput}
            value={item}
            rows={2}
            onChange={(e) => setItem(i, e.target.value)}
          />
          <button
            type="button"
            className={styles.rowRemove}
            onClick={() => onChange({ ...block, items: block.items.filter((_, j) => j !== i) })}
          >
            Remove
          </button>
        </div>
      ))}
      <Button
        size="sm"
        variant="secondary"
        type="button"
        onClick={() => onChange({ ...block, items: [...block.items, ""] })}
      >
        + Item
      </Button>
    </div>
  );
}

export function RulesSectionEditor({
  content,
  onChange,
}: {
  content: string;
  onChange: (html: string) => void;
}) {
  const [mode, setMode] = useState<"visual" | "html">("visual");
  const [blocks, setBlocks] = useState<RulesBlock[]>(() => parseRulesHtml(content));
  const [rawHtml, setRawHtml] = useState(content);

  const syncBlocks = (next: RulesBlock[]) => {
    setBlocks(next);
    onChange(serializeRulesHtml(next));
  };

  const updateBlock = (index: number, next: RulesBlock) => {
    const copy = [...blocks];
    copy[index] = next;
    syncBlocks(copy);
  };

  const addBlock = (type: RulesBlock["type"]) => {
    if (type === "table") {
      syncBlocks([
        ...blocks,
        {
          type: "table",
          hasHeader: true,
          headers: ["Violation", "1st Time", "2nd Time", "3rd Time"],
          rows: [[{ text: "" }, { text: "" }, { text: "" }, { text: "" }]],
        },
      ]);
    } else if (type === "note") {
      syncBlocks([...blocks, { type: "note", text: "" }]);
    } else if (type === "list") {
      syncBlocks([...blocks, { type: "list", ordered: false, items: [""] }]);
    }
  };

  if (mode === "html") {
    return (
      <div className={styles.editorShell}>
        <div className={styles.editorModeBar}>
          <span className="muted">Advanced HTML</span>
          <Button size="sm" variant="secondary" type="button" onClick={() => {
            setBlocks(parseRulesHtml(rawHtml));
            setMode("visual");
          }}>
            Back to visual editor
          </Button>
        </div>
        <textarea
          className={styles.rawEditor}
          value={rawHtml}
          onChange={(e) => {
            setRawHtml(e.target.value);
            onChange(e.target.value);
          }}
          rows={16}
          spellCheck={false}
        />
      </div>
    );
  }

  return (
    <div className={styles.editorShell}>
      <div className={styles.editorModeBar}>
        <span className="muted">Edit rows and cells directly — no HTML required.</span>
        <Button size="sm" variant="secondary" type="button" onClick={() => {
          setRawHtml(serializeRulesHtml(blocks));
          setMode("html");
        }}>
          Advanced HTML
        </Button>
      </div>

      {blocks.map((block, i) => (
        <div key={i} className={styles.blockEditor}>
          {block.type === "note" && (
            <>
              <label className={styles.blockLabel}>Notice</label>
              <textarea
                className={styles.noteInput}
                value={block.text}
                rows={2}
                placeholder="Important note shown above or below a table…"
                onChange={(e) => updateBlock(i, { ...block, text: e.target.value })}
              />
            </>
          )}
          {block.type === "table" && (
            <>
              <label className={styles.blockLabel}>Table</label>
              <TableBlockEditor block={block} onChange={(next) => updateBlock(i, next)} />
            </>
          )}
          {block.type === "list" && (
            <>
              <label className={styles.blockLabel}>Bullet list</label>
              <ListBlockEditor block={block} onChange={(next) => updateBlock(i, next)} />
            </>
          )}
          {block.type === "html" && (
            <>
              <label className={styles.blockLabel}>Custom block</label>
              <textarea
                className={styles.rawEditor}
                value={block.html}
                rows={6}
                onChange={(e) => updateBlock(i, { type: "html", html: e.target.value })}
              />
            </>
          )}
          <div className={styles.blockActions}>
            <button
              type="button"
              className={styles.blockRemove}
              onClick={() => syncBlocks(blocks.filter((_, j) => j !== i))}
            >
              Remove block
            </button>
          </div>
        </div>
      ))}

      <div className={styles.addBlockBar}>
        <span className="muted">Add:</span>
        <Button size="sm" variant="secondary" type="button" onClick={() => addBlock("table")}>Table</Button>
        <Button size="sm" variant="secondary" type="button" onClick={() => addBlock("note")}>Notice</Button>
        <Button size="sm" variant="secondary" type="button" onClick={() => addBlock("list")}>List</Button>
      </div>
    </div>
  );
}
