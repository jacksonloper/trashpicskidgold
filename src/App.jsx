import { useState, useCallback } from "react";
import ApiKeyInput from "./components/ApiKeyInput";
import CharacterEditor from "./components/CharacterEditor";
import Illustration from "./components/Illustration";
import {
  buildCharacterSheetPrompt,
  buildIllustrationPrompt,
  generateImage,
  generateImageWithReference,
} from "./gemini";
import "./App.css";

const initialCharacters = [
  { name: "", description: "" },
];

export default function App() {
  const [apiKey, setApiKey] = useState("");
  const [characters, setCharacters] = useState(initialCharacters);
  const [characterSheetUrl, setCharacterSheetUrl] = useState(null);
  const [generatingSheet, setGeneratingSheet] = useState(false);
  const [illustrations, setIllustrations] = useState([]);
  const [error, setError] = useState(null);

  /* ---------- character sheet ---------- */

  const handleGenerateSheet = useCallback(async () => {
    setError(null);
    setGeneratingSheet(true);
    try {
      const prompt = buildCharacterSheetPrompt(characters);
      const dataUrl = await generateImage(apiKey, prompt);
      setCharacterSheetUrl(dataUrl);
    } catch (err) {
      setError(err.message);
    } finally {
      setGeneratingSheet(false);
    }
  }, [apiKey, characters]);

  /* ---------- illustrations ---------- */

  const addIllustration = () => {
    setIllustrations((prev) => [
      ...prev,
      { caption: "", imageUrl: null, generating: false },
    ]);
  };

  const removeIllustration = (idx) => {
    setIllustrations((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateCaption = (idx, caption) => {
    setIllustrations((prev) =>
      prev.map((ill, i) => (i === idx ? { ...ill, caption } : ill))
    );
  };

  const handleGenerateIllustration = useCallback(
    async (idx) => {
      setError(null);
      setIllustrations((prev) =>
        prev.map((ill, i) =>
          i === idx ? { ...ill, generating: true } : ill
        )
      );

      try {
        const caption = illustrations[idx].caption;
        const prompt = buildIllustrationPrompt(characters, caption);

        // Extract base64 from the character sheet data URL
        const base64 = characterSheetUrl.split(",")[1];
        const mimeType = characterSheetUrl.split(";")[0].split(":")[1];

        const dataUrl = await generateImageWithReference(
          apiKey,
          prompt,
          base64,
          mimeType
        );

        setIllustrations((prev) =>
          prev.map((ill, i) =>
            i === idx ? { ...ill, imageUrl: dataUrl, generating: false } : ill
          )
        );
      } catch (err) {
        setError(err.message);
        setIllustrations((prev) =>
          prev.map((ill, i) =>
            i === idx ? { ...ill, generating: false } : ill
          )
        );
      }
    },
    [apiKey, characters, characterSheetUrl, illustrations]
  );

  return (
    <div className="app">
      <header>
        <h1>📖 Story Maker</h1>
        <p className="subtitle">
          Create a character sheet and illustrated story pages with AI
        </p>
      </header>

      <main>
        <ApiKeyInput apiKey={apiKey} onApiKeyChange={setApiKey} />

        <CharacterEditor
          characters={characters}
          onCharactersChange={setCharacters}
          onGenerate={handleGenerateSheet}
          characterSheetUrl={characterSheetUrl}
          generating={generatingSheet}
          disabled={!apiKey.trim()}
        />

        <section className="card">
          <h2>📚 Story Pages</h2>
          <p className="section-description">
            Add pages to your story. Each page has a caption that describes the
            scene. The AI will use your character sheet to keep the characters
            consistent.
          </p>

          {illustrations.map((ill, idx) => (
            <Illustration
              key={idx}
              index={idx}
              caption={ill.caption}
              imageUrl={ill.imageUrl}
              generating={ill.generating}
              onCaptionChange={(val) => updateCaption(idx, val)}
              onGenerate={() => handleGenerateIllustration(idx)}
              onRemove={() => removeIllustration(idx)}
              disabled={!characterSheetUrl}
            />
          ))}

          <button
            type="button"
            className="btn-secondary"
            onClick={addIllustration}
          >
            + Add Page
          </button>
        </section>

        {error && (
          <div className="error-banner" role="alert">
            <strong>Error:</strong> {error}
            <button
              type="button"
              className="btn-small"
              onClick={() => setError(null)}
            >
              Dismiss
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
