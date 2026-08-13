import { useEffect, useRef } from "react";
import styles from "./AnnouncementsPage.module.css";

export function RichTextEditor({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef(value);

  useEffect(() => {
    if (!ref.current) return;
    if (value !== last.current) {
      ref.current.innerHTML = value || "";
      last.current = value;
    }
  }, [value]);

  useEffect(() => {
    if (!ref.current) return;
    if (!ref.current.innerHTML && value) {
      ref.current.innerHTML = value;
      last.current = value;
    }
  }, []);

  const emit = () => {
    const html = ref.current?.innerHTML || "";
    last.current = html;
    onChange(html);
  };

  const cmd = (command: string, arg?: string) => {
    if (disabled) return;
    ref.current?.focus();
    document.execCommand(command, false, arg);
    emit();
  };

  const addLink = () => {
    if (disabled) return;
    const url = window.prompt("Link URL");
    if (!url) return;
    cmd("createLink", url);
  };

  return (
    <div className={styles.editorWrap}>
      {!disabled && (
        <div className={styles.toolbar} role="toolbar" aria-label="Formatting">
          <button type="button" onClick={() => cmd("bold")} title="Bold"><b>B</b></button>
          <button type="button" onClick={() => cmd("italic")} title="Italic"><i>I</i></button>
          <button type="button" onClick={() => cmd("underline")} title="Underline"><u>U</u></button>
          <button type="button" onClick={() => cmd("insertUnorderedList")} title="Bullet list">• List</button>
          <button type="button" onClick={() => cmd("insertOrderedList")} title="Numbered list">1. List</button>
          <button type="button" onClick={addLink} title="Link">Link</button>
        </div>
      )}
      <div
        ref={ref}
        className={styles.editor}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={emit}
        data-placeholder="Write the announcement…"
      />
    </div>
  );
}
