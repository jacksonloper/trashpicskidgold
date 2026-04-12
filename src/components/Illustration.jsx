import { useState } from "react";
import { TEXT_MODELS } from "../gemini";

export default function Illustration({
  index,
  caption,
  imageUrl,
  generating,
  planning,
  onCaptionChange,
  onPlanIllustration,
  onRemove,
  onMoveUp,
  onMoveDown,
}) {
  const [textModel, setTextModel] = useState(TEXT_MODELS[0].id);
  const canPlan = !generating && !planning && caption.trim().length > 0;

  return (
    <div className="card illustration-card">
      <div className="illustration-header">
        <h3>Page {index + 1}</h3>
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
            title="Remove illustration"
          >
            ✕
          </button>
        </div>
      </div>

      <input
        type="text"
        className="caption-input"
        placeholder="Describe this scene (e.g. Pugtato and Cabpig have a tea party in a garden)"
        value={caption}
        onChange={(e) => onCaptionChange(e.target.value)}
      />

      <div className="model-select-row">
        <label className="model-select-label">
          Planning model
          <select
            value={textModel}
            onChange={(e) => setTextModel(e.target.value)}
          >
            {TEXT_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <button
        type="button"
        className="btn-primary"
        disabled={!canPlan}
        onClick={() => onPlanIllustration(textModel)}
      >
        {planning
          ? "Planning…"
          : generating
            ? "Generating…"
            : "🖼️ Generate Illustration"}
      </button>

      {imageUrl && (
        <div className="image-preview">
          <img src={imageUrl} alt={caption || "Story illustration"} />
        </div>
      )}
    </div>
  );
}
