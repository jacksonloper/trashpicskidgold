import { useState } from "react";
import { IMAGE_MODELS } from "../gemini";

/**
 * Modal shown after the AI plans a picture — a page's illustration, or one of
 * the reference pictures the pages are drawn from.
 * Lets the user review/edit the prompt and toggle reference images
 * before approving generation.
 *
 * Props:
 *   plan          – { prompt, referenceImageIds, imageModel? }
 *   title         – what is being reviewed, e.g. "Review Illustration Plan"
 *   targetLabel   – which page or reference the plan is for; the plan can
 *                   arrive after the user has moved on to a different section
 *   notice        – optional warning to show above the prompt (damaged reply,
 *                   failed generation) so the user knows why they are here
 *   candidates    – [{ imageId, label, url }] every picture the generator may
 *                   be shown; the caller decides what belongs on the list
 *   onApprove(plan) – called with final { prompt, referenceImageIds, imageModel }
 *   onCancel()
 */
export default function IllustrationPlanModal({
  plan,
  title = "Review Illustration Plan",
  notice,
  targetLabel,
  candidates,
  onApprove,
  onCancel,
}) {
  const [prompt, setPrompt] = useState(plan.prompt);
  const [selectedIds, setSelectedIds] = useState(
    () => new Set(plan.referenceImageIds)
  );
  // Reopened after a failed generation, the plan carries the model they picked.
  const [imageModel, setImageModel] = useState(
    plan.imageModel || IMAGE_MODELS[0].id
  );

  const toggle = (imageId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(imageId)) next.delete(imageId);
      else next.add(imageId);
      return next;
    });
  };

  const handleApprove = () => {
    onApprove({ prompt, referenceImageIds: [...selectedIds], imageModel });
  };

  return (
    <div className="plan-modal-overlay" onClick={onCancel}>
      <div className="plan-modal" onClick={(e) => e.stopPropagation()}>
        <h3>
          {title}
          {targetLabel && (
            <span className="plan-modal-target"> — {targetLabel}</span>
          )}
        </h3>

        {notice && (
          <p className="plan-notice" role="alert">
            {notice}
          </p>
        )}

        <label className="plan-label">Prompt</label>
        <textarea
          className="markdown-input plan-prompt-input"
          rows={6}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
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
                    checked={selectedIds.has(c.imageId)}
                    onChange={() => toggle(c.imageId)}
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
            disabled={!prompt.trim()}
            onClick={handleApprove}
          >
            ✅ Approve &amp; Generate
          </button>
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
