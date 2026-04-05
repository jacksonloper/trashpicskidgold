import { useState } from "react";
import { IMAGE_MODELS } from "../gemini";

const KIND_OPTIONS = [
  { value: "character", label: "🧑 Character" },
  { value: "scene", label: "🏞️ Scene" },
  { value: "other", label: "📎 Other" },
];

export default function ReferenceGraphics({
  referenceGraphics,
  refImages,
  onAdd,
  onRemove,
  onUpdateLabel,
  onUpdateKind,
  onGenerate,
  onUpload,
  generatingIds,
  disabled,
}) {
  const [expandedId, setExpandedId] = useState(null);
  const [prompts, setPrompts] = useState({});
  const [imageModels, setImageModels] = useState({});

  const handlePromptChange = (id, value) => {
    setPrompts((prev) => ({ ...prev, [id]: value }));
  };

  const handleModelChange = (id, value) => {
    setImageModels((prev) => ({ ...prev, [id]: value }));
  };

  const handleGenerate = (rg) => {
    const prompt =
      prompts[rg.id] !== undefined ? prompts[rg.id] : rg.prompt || "";
    const model = imageModels[rg.id] || IMAGE_MODELS[0].id;
    if (prompt.trim()) onGenerate(rg.id, rg.kind, prompt, model);
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
        Add reference images (character sheets, scene references, style guides,
        etc.) for the AI to use when illustrating your story.
      </p>

      {referenceGraphics.map((rg) => {
        const isGenerating = !!generatingIds[rg.id];
        const imageUrl = rg.imageId ? refImages[rg.imageId] ?? null : null;
        const isExpanded = expandedId === rg.id;

        return (
          <div key={rg.id} className="ref-graphic-card card">
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
                placeholder="Label (e.g. Luna the Fox, Forest Background)"
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
                  placeholder={
                    rg.kind === "character"
                      ? "Describe the character (e.g. a small round potato with a pug face)…"
                      : "Describe the image to generate…"
                  }
                  value={
                    prompts[rg.id] !== undefined
                      ? prompts[rg.id]
                      : rg.prompt || ""
                  }
                  onChange={(e) => handlePromptChange(rg.id, e.target.value)}
                />
                <div className="model-select-row">
                  <label className="model-select-label">
                    Image model
                    <select
                      value={imageModels[rg.id] || IMAGE_MODELS[0].id}
                      onChange={(e) => handleModelChange(rg.id, e.target.value)}
                    >
                      {IMAGE_MODELS.map((m) => (
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
                  disabled={
                    disabled ||
                    isGenerating ||
                    !(
                      prompts[rg.id] !== undefined
                        ? prompts[rg.id]
                        : rg.prompt || ""
                    ).trim()
                  }
                  onClick={() => handleGenerate(rg)}
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
