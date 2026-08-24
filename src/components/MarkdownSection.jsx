export default function MarkdownSection({
  index,
  content,
  onContentChange,
  onRemove,
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
            onClick={onMoveUp}
            disabled={!onMoveUp}
            title="Move up"
          >
            ▲
          </button>
          <button
            type="button"
            className="btn-move"
            onClick={onMoveDown}
            disabled={!onMoveDown}
            title="Move down"
          >
            ▼
          </button>
          <button
            type="button"
            className="btn-remove"
            onClick={onRemove}
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
        onChange={(e) => onContentChange(e.target.value)}
      />
    </div>
  );
}
