export default function MarkdownSection({
  index,
  content,
  onContentChange,
  onRemove,
}) {
  return (
    <div className="card markdown-card">
      <div className="illustration-header">
        <h3>📝 Text Block {index + 1}</h3>
        <button
          type="button"
          className="btn-remove"
          onClick={onRemove}
          title="Remove text block"
        >
          ✕
        </button>
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
