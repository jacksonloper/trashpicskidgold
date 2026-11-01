import { useState } from "react";

/** One key: the box, Show, and Save. */
function KeyRow({ id, value, onChange, onSave, saved, placeholder }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="api-key-row">
      <input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
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
        onClick={onSave}
        disabled={!value.trim()}
      >
        {saved ? "✓ Saved" : "💾 Save Key"}
      </button>
    </div>
  );
}

/**
 * The grown-up's keys. Gemini's is the one the app is built around: it
 * plans, draws and reads aloud. A Bedrock key is optional and only draws,
 * with Stability AI's models, so it sits folded away until there is one.
 */
export default function ApiKeyInput({
  apiKey,
  onApiKeyChange,
  onSaveKey,
  saved,
  bedrockKey,
  onBedrockKeyChange,
  onSaveBedrockKey,
  bedrockSaved,
}) {
  // Folded by default; a saved Bedrock key (which arrives from the database
  // a moment after the page does) unfolds it. Once the grown-up has clicked
  // the fold themselves, their choice stands.
  const [toggledTo, setToggledTo] = useState(null);
  const bedrockOpen = toggledTo ?? (bedrockSaved && !!bedrockKey);

  return (
    <div className="api-key-section">
      <label htmlFor="api-key">Gemini API Key</label>
      <KeyRow
        id="api-key"
        value={apiKey}
        onChange={onApiKeyChange}
        onSave={onSaveKey}
        saved={saved}
        placeholder="Paste your Gemini API key here"
      />
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

      <details
        className="api-key-more"
        open={bedrockOpen}
        onToggle={(e) => setToggledTo(e.currentTarget.open)}
      >
        <summary>Also draw with AWS Bedrock (optional)</summary>
        <label htmlFor="bedrock-api-key">Bedrock API Key</label>
        <KeyRow
          id="bedrock-api-key"
          value={bedrockKey}
          onChange={onBedrockKeyChange}
          onSave={onSaveBedrockKey}
          saved={bedrockSaved}
          placeholder="Paste your Amazon Bedrock API key here"
        />
        <p className="hint">
          Adds Stability AI&apos;s image models to the pickers: a different
          look, and different filters. Make a key under{" "}
          <a
            href="https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            Amazon Bedrock → API keys
          </a>{" "}
          in the AWS console, with the console set to US West (Oregon):
          a key only works in the region it was made in, and these models
          live there. Each picture is billed to your AWS account, a few
          cents apiece. These models draw from the prompt alone and
          don&apos;t look at reference pictures. Planning and reading aloud
          still use Gemini.
        </p>
      </details>
    </div>
  );
}
