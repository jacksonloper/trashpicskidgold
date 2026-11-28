import { useEffect, useRef } from "react";
import { useHasReading } from "../useReadAloud";
import { formatEdited } from "../editedAt";

/**
 * A tiny microphone on a row whose page already has Gemini's reading kept
 * for the current voice acting, so P will play it straight away.
 */
function VoiceMark({ section, acting }) {
  const has = useHasReading(section, acting);
  if (!has) return null;
  return (
    <span
      className="section-index-voice"
      title="Voice ready: P plays Gemini's reading of this page"
      aria-label="voice ready"
    >
      🎙️
    </span>
  );
}

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
 *
 * The list is a single stop for Tab — only the selected row is tabbable, and
 * the arrow keys move from there (the roving-tabindex pattern). So reaching
 * the list costs one Tab rather than one per page, and once you are in it
 * plain ↑/↓ walk the story. Backslash goes straight there from anywhere
 * outside a text box (see useSectionShortcuts).
 */
export default function SectionIndex({
  sections,
  activeId,
  generatingSections,
  planningSections,
  onSelect,
  onAddMarkdown,
  onAddIllustration,
  acting,
  voiceOff,
  storyUpdatedAt,
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

  const pages = sections.filter((s) => s.type === "illustration").length;
  const texts = sections.length - pages;
  const edited = formatEdited(storyUpdatedAt);

  return (
    <section className="card section-index">
      <h2>📚 Story Sections</h2>
      <p className="section-index-summary">
        {pages} {pages === 1 ? "page" : "pages"}
        {texts > 0 && (
          <>
            {" "}· {texts} text {texts === 1 ? "block" : "blocks"}
          </>
        )}
        {edited && (
          <>
            {" "}· last edited{" "}
            <time dateTime={new Date(storyUpdatedAt).toISOString()}>
              {edited}
            </time>
          </>
        )}
      </p>
      <p className="section-description">
        Your story in order — pick a page to work on it. Unless you are typing,{" "}
        <kbd>↑</kbd>/<kbd>↓</kbd> (or <kbd>j</kbd>/<kbd>k</kbd>,{" "}
        <kbd>Home</kbd>/<kbd>End</kbd>) turn pages from anywhere;{" "}
        <kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> does the same while you are
        typing. Hold either to go faster. <kbd>P</kbd> reads the page aloud;
        turning the page stops it. <kbd>{"\\"}</kbd> jumps to the list;{" "}
        <kbd>S</kbd> opens the story picker.
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
                  // Roving tabindex: Tab reaches the list once, at the row you
                  // are on, and the arrows take over from there.
                  tabIndex={isActive ? 0 : -1}
                  aria-keyshortcuts={isActive ? "\\ P" : undefined}
                  title={
                    sec.editedAt
                      ? `Last edited ${formatEdited(sec.editedAt)}`
                      : "Last edit not recorded"
                  }
                  onClick={() => onSelect(sec.id)}
                >
                  <span className="section-index-num">{idx + 1}</span>
                  <span className="section-index-icon">
                    {sec.type === "illustration" ? "🖼️" : "📝"}
                  </span>
                  <span className="section-index-text">{preview(sec)}</span>
                  {acting && !voiceOff && (
                    <VoiceMark section={sec} acting={acting} />
                  )}
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
