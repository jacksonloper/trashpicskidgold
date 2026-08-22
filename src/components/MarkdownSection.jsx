import { memo } from "react";

/**
 * A text block in the story.
 *
 * Memoized, and every callback takes the section id rather than being bound to
 * it by the parent — a story can run to dozens of sections, and without this
 * each keystroke anywhere re-renders every one of them.
 */
function MarkdownSection({
  id,
  index,
  content,
  onContentChange,
  onRemove,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
}) {
  return (
    <div className="card markdown-card">
      <div className="illustration-header">
        <h3>📝 Text Block {index + 1}</h3>
        <div className="section-header-actions">
          <button
            type="button"
            className="btn-move"
            onClick={() => onMoveUp(id)}
            disabled={!canMoveUp}
            title="Move up"
          >
            ▲
          </button>
          <button
            type="button"
            className="btn-move"
            onClick={() => onMoveDown(id)}
            disabled={!canMoveDown}
            title="Move down"
          >
            ▼
          </button>
          <button
            type="button"
            className="btn-remove"
            onClick={() => onRemove(id)}
            title="Remove text block"
          >
            ✕
          </button>
        </div>
      </div>

      <textarea
        className="markdown-input"
        rows={4}
        placeholder="Write story text here (supports markdown)"
        value={content}
        onChange={(e) => onContentChange(id, e.target.value)}
      />
    </div>
  );
}

export default memo(MarkdownSection);
