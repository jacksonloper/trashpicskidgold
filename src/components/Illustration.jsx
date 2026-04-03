export default function Illustration({
  index,
  caption,
  imageUrl,
  generating,
  onCaptionChange,
  onGenerate,
  onRemove,
  disabled,
}) {
  const canGenerate = !disabled && !generating && caption.trim().length > 0;

  return (
    <div className="card illustration-card">
      <div className="illustration-header">
        <h3>Page {index + 1}</h3>
        <button
          type="button"
          className="btn-remove"
          onClick={onRemove}
          title="Remove illustration"
        >
          ✕
        </button>
      </div>

      <input
        type="text"
        className="caption-input"
        placeholder="Describe this scene (e.g. Pugtato and Cabpig have a tea party in a garden)"
        value={caption}
        onChange={(e) => onCaptionChange(e.target.value)}
      />

      <button
        type="button"
        className="btn-primary"
        disabled={!canGenerate}
        onClick={onGenerate}
      >
        {generating ? "Generating…" : "🖼️ Generate Illustration"}
      </button>

      {disabled && !generating && (
        <p className="hint">Generate the character sheet first.</p>
      )}

      {imageUrl && (
        <div className="image-preview">
          <img src={imageUrl} alt={caption || "Story illustration"} />
        </div>
      )}
    </div>
  );
}
