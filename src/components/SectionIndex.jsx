import { useEffect, useRef } from "react";

/** One line of preview text for a section row. */
function preview(sec) {
  if (sec.type === "illustration") {
    return sec.caption?.trim() || "Untitled page";
  }
  const firstLine = (sec.content ?? "").trim().split("\n")[0];
  return firstLine || "Empty text block";
}

/**
 * The whole story as a list of one-line rows, with one row selected.
 *
 * This is what you get instead of scrolling through every page: the sequence
 * stays visible and cheap to render, while only the selected section is
 * actually mounted as an editor.
 */
export default function SectionIndex({
  sections,
  activeId,
  generatingSections,
  planningSections,
  onSelect,
  onAddMarkdown,
  onAddIllustration,
}) {
  const activeRef = useRef(null);

  // Keep the selected row visible when the selection moves by Previous/Next
  // or by the keyboard rather than by a click on the list itself.
  useEffect(() => {
    const row = activeRef.current;
    if (!row) return;
    row.scrollIntoView({ block: "nearest" });
    // When the keyboard is what moved the selection, the keyboard should
    // follow it — otherwise the next arrow press has nothing to act on.
    const focused = document.activeElement;
    if (focused !== row && focused?.classList.contains("section-index-row")) {
      row.focus({ preventScroll: true });
    }
  }, [activeId]);

  return (
    <section className="card">
      <h2>📚 Story Sections</h2>
      <p className="section-description">
        Your story in order. Pick a page to work on it — one at a time, so a
        long story stays quick to edit. <kbd>Alt</kbd>+<kbd>↑</kbd> and{" "}
        <kbd>Alt</kbd>+<kbd>↓</kbd> move between pages while you type; hold to
        go faster. In this list the plain arrows, <kbd>j</kbd>/<kbd>k</kbd> and{" "}
        <kbd>Home</kbd>/<kbd>End</kbd> work too.
      </p>

      {sections.length === 0 ? (
        <p className="section-index-empty">
          No pages yet. Add a text block or an illustration to get started.
        </p>
      ) : (
        <ol className="section-index-list">
          {sections.map((sec, idx) => {
            const isActive = sec.id === activeId;
            const busy = generatingSections[sec.id]
              ? "Generating…"
              : planningSections[sec.id]
                ? "Planning…"
                : null;
            return (
              <li key={sec.id}>
                <button
                  type="button"
                  ref={isActive ? activeRef : null}
                  className={
                    "section-index-row" + (isActive ? " is-active" : "")
                  }
                  aria-current={isActive ? "true" : undefined}
                  onClick={() => onSelect(sec.id)}
                >
                  <span className="section-index-num">{idx + 1}</span>
                  <span className="section-index-icon">
                    {sec.type === "illustration" ? "🖼️" : "📝"}
                  </span>
                  <span className="section-index-text">{preview(sec)}</span>
                  {busy ? (
                    <span className="section-index-badge is-busy">{busy}</span>
                  ) : sec.type === "illustration" && !sec.imageId ? (
                    <span className="section-index-badge">no picture yet</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <div className="add-section-row">
        <button type="button" className="btn-secondary" onClick={onAddMarkdown}>
          📝 Add Text
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={onAddIllustration}
        >
          🖼️ Add Illustration
        </button>
      </div>
    </section>
  );
}
