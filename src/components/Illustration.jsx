import { memo, useState } from "react";
import { TEXT_MODELS, IMAGE_MODELS } from "../gemini";

/**
 * One illustrated page.
 *
 * Memoized, and every callback takes the section id rather than being bound to
 * it by the parent — a 70-page story renders 70 of these, and without this
 * each keystroke anywhere re-renders every one of them.
 */
function Illustration({
  id,
  index,
  caption,
  imageUrl,
  generating,
  planning,
  onCaptionChange,
  onGenerateIllustration,
  onPlanIllustration,
  onRemove,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
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
        onChange={(e) => onCaptionChange(id, e.target.value)}
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
          onClick={() => onGenerateIllustration(id, textModel, imageModel)}
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
          onClick={() => onPlanIllustration(id, textModel)}
          title="Plan the prompt first, then review and edit it before generating"
        >
          📝 Generate Text &amp; Preview
        </button>
      </div>

      {imageUrl && (
        <div className="image-preview">
          <img src={imageUrl} alt={caption || "Story illustration"} />
        </div>
      )}
    </div>
  );
}

export default memo(Illustration);
