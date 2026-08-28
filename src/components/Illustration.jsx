import { useState } from "react";
import GrowingTextarea from "./GrowingTextarea";
import SectionHeader from "./SectionHeader";
import { TEXT_MODELS, IMAGE_MODELS } from "../gemini";

/*
 * A caption is one line of text, however many lines it takes to show.
 *
 * It goes into the image prompt, the index row, the exported file name and the
 * `![…]()` in story.md — all of which want a single line — so a pasted-in line
 * break becomes a space rather than something that has to be handled in four
 * places later.
 */
function oneLine(text) {
  return text.replace(/\s*\n\s*/g, " ");
}

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
      <SectionHeader
        title={`Page ${index + 1}`}
        noun="page"
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        onRemove={onRemove}
      />

      <GrowingTextarea
        className="caption-input caption-text"
        placeholder="Describe this scene (e.g. Pugtato and Cabpig have a tea party in a garden)"
        value={caption}
        onChange={(e) => onCaptionChange(oneLine(e.target.value))}
        // Enter did nothing in the text field this replaces, and a caption has
        // nothing to submit to; keep it from opening a line the caption can't
        // keep.
        onKeyDown={(e) => {
          if (e.key === "Enter") e.preventDefault();
        }}
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
