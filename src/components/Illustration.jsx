import { useState } from "react";
import { TEXT_MODELS, IMAGE_MODELS } from "../gemini";

export default function Illustration({
  index,
  caption,
  imageUrl,
  generating,
  planning,
  onCaptionChange,
  onGenerateIllustration,
  onPlanIllustration,
  onRemove,
  onMoveUp,
  onMoveDown,
  onImageShown,
}) {
  const [textModel, setTextModel] = useState(TEXT_MODELS[0].id);
  const [imageModel, setImageModel] = useState(IMAGE_MODELS[0].id);
  const canGenerate = !generating && !planning && caption.trim().length > 0;

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

        <label className="model-select-label">
          Image model
          <select
            value={imageModel}
            onChange={(e) => setImageModel(e.target.value)}
          >
            {IMAGE_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="illustration-actions">
        <button
          type="button"
          className="btn-primary"
          disabled={!canGenerate}
          onClick={() => onGenerateIllustration(textModel, imageModel)}
        >
          {planning
            ? "Planning…"
            : generating
              ? "Generating…"
              : "🖼️ Generate Illustration"}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={!canGenerate}
          onClick={() => onPlanIllustration(textModel)}
          title="Plan the prompt first, then review and edit it before generating"
        >
          📝 Generate Text &amp; Preview
        </button>
      </div>

      {imageUrl && (
        <div className="image-preview">
          {/* Until it decodes the picture has no height, so whoever scrolled
              it into view has to aim again once it does. */}
          <img
            src={imageUrl}
            alt={caption || "Story illustration"}
            onLoad={onImageShown}
          />
        </div>
      )}
    </div>
  );
}
