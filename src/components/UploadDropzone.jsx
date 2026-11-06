import { useEffect, useRef, useState } from "react";

/**
 * One box for everything that can be put into the app from outside.
 *
 * A hidden `<input type="file">` behind a button is the smallest upload there
 * is, and the slowest: find the file in the picker, every time. So anywhere a
 * file can come in opens this instead — a box that takes a file dragged onto
 * it, a picture pasted from the clipboard (a screenshot, an image copied from
 * a web page), or, for whoever still wants it, the picker behind a button.
 *
 * The box is the whole dialog: a file dropped anywhere on the overlay lands,
 * and a paste lands wherever the keyboard is, because the dialog takes focus
 * when it opens. Escape or a click outside closes it with nothing taken.
 *
 * Whatever arrives is checked against `accept` the way the picker would check
 * it, since the clipboard and the desktop don't filter: pasting a sentence
 * into the picture box says so and keeps the box open for another try.
 *
 * Props:
 *   title    – heading
 *   accept   – the picker's accept string ("image/*", ".zip,application/zip")
 *   multiple – take every file that fits, not just the first
 *   noun     – what the box wants, for its copy ("a picture", "story ZIPs")
 *   onFiles(files) – the accepted File objects; the caller closes the dialog
 *   onClose()
 */
export default function UploadDropzone({
  title,
  accept = "",
  multiple = false,
  noun = "a file",
  onFiles,
  onClose,
}) {
  const boxRef = useRef(null);
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);
  const [note, setNote] = useState(null);

  const fits = makeAcceptTest(accept);

  /** Everything handed over goes through here, whichever way it came. */
  const take = (list, how) => {
    const files = Array.from(list ?? []).filter(fits);
    if (files.length === 0) {
      setNote(rejection(how, noun, list));
      return;
    }
    setNote(null);
    onFiles(multiple ? files : files.slice(0, 1));
  };

  // The box owns the keyboard while it is open: focus so a paste goes to it
  // straight away, Escape to leave.
  useEffect(() => {
    boxRef.current?.focus();
    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Paste is listened for on the whole window, not just the box, so it works
  // wherever focus has wandered to inside the dialog.
  useEffect(() => {
    const onPaste = (e) => {
      const data = e.clipboardData;
      if (!data) return;
      e.preventDefault();
      take(data.files, "paste");
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  const handleDragOver = (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    if (!over) setOver(true);
  };

  // dragleave fires on every child boundary crossed; only leaving the overlay
  // itself (for the browser chrome, or another window) counts.
  const handleDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setOver(false);
    take(e.dataTransfer?.files, "drop");
  };

  const handlePick = (e) => {
    // Copy the list before the reset empties it; the reset is so picking the
    // same file twice still fires a change event.
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    take(files, "pick");
  };

  return (
    <div
      className="plan-modal-overlay"
      onClick={onClose}
      onDragOver={handleDragOver}
      onDragEnter={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div
        className="plan-modal upload-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{title}</h3>

        <div
          ref={boxRef}
          className={`upload-dropzone${over ? " is-over" : ""}`}
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
        >
          <div className="upload-dropzone-icon" aria-hidden="true">
            {over ? "📂" : "📁"}
          </div>
          <p className="upload-dropzone-main">
            {over ? `Drop ${noun} here` : `Drag ${noun} here`}
          </p>
          <p className="upload-dropzone-hint">
            or paste from the clipboard (<kbd>Ctrl</kbd>+<kbd>V</kbd> /{" "}
            <kbd>⌘</kbd>+<kbd>V</kbd>), or click to choose{" "}
            {multiple ? "files" : "a file"}
          </p>
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            multiple={multiple}
            style={{ display: "none" }}
            onChange={handlePick}
            // The box is the button; the input is only its picker.
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          />
        </div>

        {note && (
          <p className="upload-note" role="status">
            {note}
          </p>
        )}

        <div className="plan-modal-buttons">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => inputRef.current?.click()}
          >
            Choose {multiple ? "files" : "a file"}…
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * A test for one File against an `accept` string, the way the picker reads
 * it: comma-separated, each entry an extension (".zip"), a whole type
 * ("image/png") or a family ("image/*"). An empty accept takes anything.
 *
 * A dropped or pasted file can arrive with no type at all (a ZIP from some
 * file managers), so the extension is checked whenever the type says nothing.
 */
function makeAcceptTest(accept) {
  const rules = accept
    .split(",")
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean);
  if (rules.length === 0) return () => true;
  return (file) => {
    const type = (file.type || "").toLowerCase();
    const name = (file.name || "").toLowerCase();
    return rules.some((rule) => {
      if (rule.startsWith(".")) return name.endsWith(rule);
      if (rule.endsWith("/*")) return type.startsWith(rule.slice(0, -1));
      return type === rule;
    });
  };
}

/** What to say when nothing that arrived fits. */
function rejection(how, noun, list) {
  const count = list?.length ?? 0;
  if (how === "paste") {
    return count === 0
      ? `Nothing on the clipboard is ${noun} — copy an image (or a file) first, then paste.`
      : `What was pasted isn't ${noun}.`;
  }
  if (how === "drop") {
    return count === 0
      ? `Nothing was dropped that the browser could read as ${noun}.`
      : `What was dropped isn't ${noun}.`;
  }
  return `That isn't ${noun}.`;
}
