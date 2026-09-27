import { useState } from "react";
import { IMAGE_MODELS, MAX_FRAMES } from "../gemini";

/**
 * Modal shown after the AI plans an illustration.
 * Lets the user review/edit the prompt and toggle reference images
 * before approving generation.
 *
 * A plan holds one frame, or two when the caption was split: the second
 * becomes a new page straight after this one, and both are drawn at once.
 * Each frame has its own caption, prompt and reference picks; the image model
 * is shared. A frame can be added or taken away here, whatever the planner
 * decided.
 *
 * Props:
 *   plan          – { sectionId, frames: [{ sectionId?, caption, prompt, referenceImageIds }], imageModel? }
 *                   a frame's empty caption leaves its page's caption alone
 *   sectionLabel  – which page the plan is for; the plan can arrive after the
 *                   user has moved on to a different section
 *   notice        – optional warning to show above the prompt (damaged reply,
 *                   failed generation) so the user knows why they are here
 *   allImages     – { imageId: dataUrl } map of all loaded images
 *   referenceGraphics – array of {id, label, imageId}
 *   sections      – story sections (for illustration images)
 *   onApprove(plan) – called with final { frames, imageModel }
 *   onCancel()
 */
export default function IllustrationPlanModal({
  plan,
  notice,
  allImages,
  sectionLabel,
  referenceGraphics,
  sections,
  onApprove,
  onCancel,
}) {
  const [frames, setFrames] = useState(() =>
    plan.frames.map((f) => ({
      ...f,
      referenceImageIds: new Set(f.referenceImageIds),
    }))
  );
  // Reopened after a failed generation, the plan carries the model they picked.
  const [imageModel, setImageModel] = useState(
    plan.imageModel || IMAGE_MODELS[0].id
  );
  const split = frames.length > 1;

  // Build a list of all candidate images (ref graphics + existing illustrations)
  const candidates = [];

  for (const rg of referenceGraphics) {
    if (rg.imageId && allImages[rg.imageId]) {
      candidates.push({
        imageId: rg.imageId,
        label: `Ref: ${rg.label || "(unlabeled)"}`,
        url: allImages[rg.imageId],
      });
    }
  }

  for (const sec of sections) {
    if (sec.type === "illustration" && sec.imageId && allImages[sec.imageId]) {
      candidates.push({
        imageId: sec.imageId,
        label: `Illustration: ${sec.caption || "(no caption)"}`,
        url: allImages[sec.imageId],
      });
    }
  }

  const editFrame = (i, change) =>
    setFrames((prev) =>
      prev.map((f, j) => (j === i ? { ...f, ...change } : f))
    );

  const toggle = (i, imageId) =>
    setFrames((prev) =>
      prev.map((f, j) => {
        if (j !== i) return f;
        const next = new Set(f.referenceImageIds);
        if (next.has(imageId)) next.delete(imageId);
        else next.add(imageId);
        return { ...f, referenceImageIds: next };
      })
    );

  // A new frame starts as a copy of the one before, which is usually most of
  // what it needs: the same style, characters and references. The words are
  // for the user to divide, starting from the page's caption as it stands.
  const addFrame = () =>
    setFrames((prev) => {
      const last = prev[prev.length - 1];
      const pageCaption =
        sections.find((sec) => sec.id === (prev[0].sectionId ?? plan.sectionId))
          ?.caption ?? "";
      return [
        ...prev.map((f, i) =>
          i === 0 && !f.caption ? { ...f, caption: pageCaption } : f
        ),
        {
          caption: "",
          prompt: last.prompt,
          referenceImageIds: new Set(last.referenceImageIds),
        },
      ];
    });

  const removeFrame = (i) =>
    setFrames((prev) => prev.filter((_, j) => j !== i));

  const canApprove = frames.every((f) => f.prompt.trim());

  const handleApprove = () => {
    onApprove({
      frames: frames.map((f) => ({
        ...f,
        caption: f.caption.replace(/\s*\n\s*/g, " ").trim(),
        referenceImageIds: [...f.referenceImageIds],
      })),
      imageModel,
    });
  };

  return (
    <div className="plan-modal-overlay" onClick={onCancel}>
      <div className="plan-modal" onClick={(e) => e.stopPropagation()}>
        <h3>
          Review Illustration Plan
          {sectionLabel && (
            <span className="plan-modal-target"> — {sectionLabel}</span>
          )}
        </h3>

        {notice && (
          <p className="plan-notice" role="alert">
            {notice}
          </p>
        )}

        {split && (
          <p className="plan-split-note">
            This caption was split into {frames.length} pictures. Each gets its
            own page, in order, and they are drawn at the same time.
          </p>
        )}

        {frames.map((f, i) => (
          <section
            key={i}
            className={split ? "plan-frame plan-frame-split" : "plan-frame"}
          >
            {split && (
              <div className="plan-frame-head">
                <h4>
                  Picture {i + 1}
                  {!f.sectionId && i > 0 && (
                    <span className="plan-modal-target"> — a new page</span>
                  )}
                </h4>
                <button
                  type="button"
                  className="btn-secondary btn-small"
                  onClick={() => removeFrame(i)}
                >
                  Remove
                </button>
              </div>
            )}

            {split && (
              <>
                <label className="plan-label">Caption</label>
                <input
                  type="text"
                  className="markdown-input plan-caption-input"
                  value={f.caption}
                  placeholder="The words under this picture"
                  onChange={(e) => editFrame(i, { caption: e.target.value })}
                />
              </>
            )}

            <label className="plan-label">Prompt</label>
            <textarea
              className="markdown-input plan-prompt-input"
              rows={6}
              value={f.prompt}
              onChange={(e) => editFrame(i, { prompt: e.target.value })}
            />

            {candidates.length > 0 && (
              <>
                <label className="plan-label">
                  Reference images to include
                </label>
                <div className="plan-ref-grid">
                  {candidates.map((c) => (
                    <label key={c.imageId} className="plan-ref-item">
                      <input
                        type="checkbox"
                        checked={f.referenceImageIds.has(c.imageId)}
                        onChange={() => toggle(i, c.imageId)}
                      />
                      <img
                        src={c.url}
                        alt={c.label}
                        className="plan-ref-thumb"
                      />
                      <span className="plan-ref-caption">{c.label}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </section>
        ))}

        {frames.length < MAX_FRAMES && (
          <button
            type="button"
            className="btn-secondary btn-small plan-add-frame"
            onClick={addFrame}
          >
            ➕ Split into two pictures
          </button>
        )}

        <div className="plan-model-select">
          <label className="plan-label">Image model</label>
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
        </div>

        <div className="plan-modal-buttons">
          <button
            type="button"
            className="btn-primary"
            disabled={!canApprove}
            onClick={handleApprove}
          >
            ✅ {split ? `Approve & Generate ${frames.length}` : "Approve & Generate"}
          </button>
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
