import SectionHeader from "./SectionHeader";

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
      <SectionHeader
        title={`📝 Text Block ${index + 1}`}
        noun="text block"
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        onRemove={onRemove}
      />

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
