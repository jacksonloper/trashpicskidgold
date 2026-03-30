import { useState } from "react";

export default function ApiKeyInput({ apiKey, onApiKeyChange, onSaveKey, saved }) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="api-key-section">
      <label htmlFor="api-key">Gemini API Key</label>
      <div className="api-key-row">
        <input
          id="api-key"
          type={visible ? "text" : "password"}
          value={apiKey}
          onChange={(e) => onApiKeyChange(e.target.value)}
          placeholder="Paste your Gemini API key here"
        />
        <button
          type="button"
          className="btn-small"
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? "Hide" : "Show"}
        </button>
        <button
          type="button"
          className="btn-small btn-save-key"
          onClick={onSaveKey}
          disabled={!apiKey.trim()}
        >
          {saved ? "✓ Saved" : "💾 Save Key"}
        </button>
      </div>
      <p className="hint">
        Get a free key at{" "}
        <a
          href="https://aistudio.google.com/app/apikey"
          target="_blank"
          rel="noopener noreferrer"
        >
          Google AI Studio
        </a>
        . Click &ldquo;Save Key&rdquo; to persist it in your browser.
      </p>
    </div>
  );
}
