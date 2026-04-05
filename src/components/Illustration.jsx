export default function Illustration({
  index,
  caption,
  imageUrl,
  generating,
  planning,
  onCaptionChange,
  onPlanIllustration,
  onRemove,
  disabled,
}) {
  const canPlan = !disabled && !generating && !planning && caption.trim().length > 0;

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
        disabled={!canPlan}
        onClick={onPlanIllustration}
      >
        {planning
          ? "Planning…"
          : generating
            ? "Generating…"
            : "🖼️ Generate Illustration"}
      </button>

      {disabled && !generating && !planning && (
        <p className="hint">Add at least one reference graphic first, or proceed without references.</p>
      )}

      {imageUrl && (
        <div className="image-preview">
          <img src={imageUrl} alt={caption || "Story illustration"} />
        </div>
      )}
    </div>
  );
}
