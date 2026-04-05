import { useState } from "react";

export default function ReferenceGraphics({
  referenceGraphics,
  refImages,
  onAdd,
  onRemove,
  onUpdateLabel,
  onGenerate,
  onUpload,
  generatingIds,
  disabled,
}) {
  const [expandedId, setExpandedId] = useState(null);
  const [prompts, setPrompts] = useState({});

  const handlePromptChange = (id, value) => {
    setPrompts((prev) => ({ ...prev, [id]: value }));
  };

  const handleGenerate = (id) => {
    const prompt = prompts[id] || "";
    if (prompt.trim()) onGenerate(id, prompt);
  };

  const handleFileChange = (id, e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => onUpload(id, reader.result);
    reader.readAsDataURL(file);
  };

  return (
    <section className="card">
      <h2>🖼️ Reference Graphics</h2>
      <p className="section-description">
        Add reference images (character sheets, style guides, props, etc.) for
        the AI to use when illustrating your story.
      </p>

      {referenceGraphics.map((rg) => {
        const isGenerating = !!generatingIds[rg.id];
        const imageUrl = rg.imageId ? refImages[rg.imageId] ?? null : null;
        const isExpanded = expandedId === rg.id;

        return (
          <div key={rg.id} className="ref-graphic-card card">
            <div className="ref-graphic-header">
              <input
                type="text"
                className="ref-graphic-label"
                placeholder="Label (e.g. Character Sheet, Background Style)"
                value={rg.label}
                onChange={(e) => onUpdateLabel(rg.id, e.target.value)}
              />
              <button
                type="button"
                className="btn-remove"
                onClick={() => onRemove(rg.id)}
                title="Remove reference graphic"
              >
                ✕
              </button>
            </div>

            {imageUrl && (
              <div className="image-preview">
                <img src={imageUrl} alt={rg.label || "Reference graphic"} />
              </div>
            )}

            <div className="ref-graphic-actions">
              <button
                type="button"
                className="btn-small"
                onClick={() => setExpandedId(isExpanded ? null : rg.id)}
              >
                {isExpanded ? "▲ Hide prompt" : "▼ Generate with prompt"}
              </button>

              <label className="btn-small ref-upload-label">
                📁 Upload Image
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => handleFileChange(rg.id, e)}
                />
              </label>
            </div>

            {isExpanded && (
              <div className="ref-graphic-prompt-area">
                <textarea
                  className="markdown-input"
                  rows={3}
                  placeholder="Describe the image to generate…"
                  value={prompts[rg.id] || ""}
                  onChange={(e) => handlePromptChange(rg.id, e.target.value)}
                />
                <button
                  type="button"
                  className="btn-primary"
                  disabled={
                    disabled ||
                    isGenerating ||
                    !(prompts[rg.id] || "").trim()
                  }
                  onClick={() => handleGenerate(rg.id)}
                >
                  {isGenerating ? "Generating…" : "🎨 Generate"}
                </button>
              </div>
            )}
          </div>
        );
      })}

      <div className="add-section-row">
        <button type="button" className="btn-secondary" onClick={onAdd}>
          + Add Reference Graphic
        </button>
      </div>
    </section>
  );
}
