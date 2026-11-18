import { useState } from "react";
import GrowingTextarea from "./GrowingTextarea";
import { TEXT_MODELS, IMAGE_MODELS } from "../gemini";
import oneLine from "../oneLine";

const KIND_OPTIONS = [
  { value: "character", label: "🧑 Character" },
  { value: "scene", label: "🏞️ Scene" },
  { value: "other", label: "📎 Other" },
];

const CAPTION_PLACEHOLDERS = {
  character:
    "Who is this? What do they look like? (e.g. a small round potato with a pug face and a red scarf)",
  scene:
    "Where is this? What does it look like? (e.g. a cosy kitchen with a round window and a wood stove)",
  other:
    "What is this? What does it look like? (e.g. a battered red wagon with one wobbly wheel)",
};

/**
 * One character (or place, or thing) on the meet-the-characters page.
 *
 * It works like a page: the caption is saved as it is typed and is the
 * material for the picture, not the prompt itself. Generate plans a prompt
 * from the caption, the story's style and the other reference pictures, then
 * draws; Generate Text & Preview stops at the plan for a look first. The
 * model choices are this card's own, like a page's, and are not saved.
 */
function RefGraphicCard({
  rg,
  imageUrl,
  generating,
  planning,
  trashCount,
  disabled,
  onRemove,
  onUpdateLabel,
  onUpdateKind,
  onUpdateCaption,
  onGenerate,
  onPlan,
  onRequestUpload,
  onTakeFromTrash,
}) {
  const [textModel, setTextModel] = useState(TEXT_MODELS[0].id);
  const [imageModel, setImageModel] = useState(IMAGE_MODELS[0].id);
  const caption = rg.caption ?? "";
  const canGenerate =
    !disabled && !generating && !planning && caption.trim().length > 0;

  return (
    <div className="ref-graphic-card card">
      <div className="ref-graphic-header">
        <select
          className="ref-graphic-kind"
          value={rg.kind}
          onChange={(e) => onUpdateKind(rg.id, e.target.value)}
        >
          {KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          className="ref-graphic-label"
          placeholder="Name (e.g. Luna the Fox, the Forest)"
          value={rg.label}
          onChange={(e) => onUpdateLabel(rg.id, e.target.value)}
        />
        <button
          type="button"
          className="btn-remove"
          onClick={() => onRemove(rg.id)}
          title="Remove this reference"
        >
          ✕
        </button>
      </div>

      <GrowingTextarea
        className="caption-input caption-text"
        placeholder={CAPTION_PLACEHOLDERS[rg.kind] ?? CAPTION_PLACEHOLDERS.other}
        value={caption}
        onChange={(e) => onUpdateCaption(rg.id, oneLine(e.target.value))}
        // One line, like a page caption: Enter has nothing to submit to.
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
          onClick={() => onGenerate(rg.id, textModel, imageModel)}
          title="Plan a prompt from the caption, then draw the picture"
        >
          {planning
            ? "Planning…"
            : generating
              ? "Generating…"
              : "🎨 Generate Reference"}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={!canGenerate}
          onClick={() => onPlan(rg.id, textModel)}
          title="Plan the prompt first, then review and edit it before generating"
        >
          📝 Generate Text &amp; Preview
        </button>
      </div>

      {/* The same two quiet alternatives a page has. */}
      <div className="illustration-side-actions">
        <button
          type="button"
          className="btn-tiny"
          onClick={() => onRequestUpload(rg.id)}
          title="Put a picture here: drop it in, paste it, or pick it from this computer"
        >
          📁 Upload reference
        </button>

        <button
          type="button"
          className="btn-tiny"
          onClick={() => onTakeFromTrash(rg.id)}
          disabled={!trashCount}
          title={
            trashCount
              ? "Put a picture you removed earlier here"
              : "The trash is empty"
          }
        >
          🗑️ Take reference from trash
          {trashCount > 0 && <> ({trashCount})</>}
        </button>
      </div>

      {imageUrl && (
        <div className="image-preview">
          <img src={imageUrl} alt={rg.label || caption || "Reference graphic"} />
        </div>
      )}
    </div>
  );
}

/**
 * Meet the characters: the people, places and things of the story, each with
 * a caption and a reference picture. Every page is drawn with these in view,
 * and a new one can be drawn with the ones already here in view — a sister
 * to match her brother, a character standing in a place that already exists.
 */
export default function ReferenceGraphics({
  referenceGraphics,
  refImages,
  onAdd,
  onRemove,
  onUpdateLabel,
  onUpdateKind,
  onUpdateCaption,
  onGenerate,
  onPlan,
  onRequestUpload,
  onTakeFromTrash,
  trashCount,
  generatingIds,
  planningIds,
  disabled,
}) {
  return (
    <section className="card">
      <h2>👋 Meet the Characters</h2>
      <p className="section-description">
        Who, and where, the story is about. Give each one a name and a caption
        saying what they look like; the picture is drawn from the caption in
        the story&rsquo;s style, and every page is drawn with these pictures
        in view so the characters stay themselves. A new character can be
        drawn alongside the ones already here &mdash; to share a family
        likeness, say, or to stand in a place that already has its picture.
      </p>

      {referenceGraphics.map((rg) => (
        <RefGraphicCard
          key={rg.id}
          rg={rg}
          imageUrl={rg.imageId ? refImages[rg.imageId] ?? null : null}
          generating={!!generatingIds[rg.id]}
          planning={!!planningIds[rg.id]}
          trashCount={trashCount}
          disabled={disabled}
          onRemove={onRemove}
          onUpdateLabel={onUpdateLabel}
          onUpdateKind={onUpdateKind}
          onUpdateCaption={onUpdateCaption}
          onGenerate={onGenerate}
          onPlan={onPlan}
          onRequestUpload={onRequestUpload}
          onTakeFromTrash={onTakeFromTrash}
        />
      ))}

      <div className="add-section-row">
        <button type="button" className="btn-secondary" onClick={onAdd}>
          + Add a Character
        </button>
      </div>
    </section>
  );
}
