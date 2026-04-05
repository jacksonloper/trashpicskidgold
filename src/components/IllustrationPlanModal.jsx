import { useState } from "react";

/**
 * Modal shown after the AI plans an illustration.
 * Lets the user review/edit the prompt and toggle reference images
 * before approving generation.
 *
 * Props:
 *   plan          – { prompt, referenceImageIds }
 *   allImages     – { imageId: dataUrl } map of all loaded images
 *   referenceGraphics – array of {id, label, imageId}
 *   sections      – story sections (for illustration images)
 *   onApprove(plan) – called with final { prompt, referenceImageIds }
 *   onCancel()
 */
export default function IllustrationPlanModal({
  plan,
  allImages,
  referenceGraphics,
  sections,
  onApprove,
  onCancel,
}) {
  const [prompt, setPrompt] = useState(plan.prompt);
  const [selectedIds, setSelectedIds] = useState(
    () => new Set(plan.referenceImageIds)
  );

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

  const toggle = (imageId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(imageId)) next.delete(imageId);
      else next.add(imageId);
      return next;
    });
  };

  const handleApprove = () => {
    onApprove({ prompt, referenceImageIds: [...selectedIds] });
  };

  return (
    <div className="plan-modal-overlay" onClick={onCancel}>
      <div className="plan-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Review Illustration Plan</h3>

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
