import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Navbar from "./components/Navbar";
import ApiKeyInput from "./components/ApiKeyInput";
import CharacterEditor from "./components/CharacterEditor";
import Illustration from "./components/Illustration";
import MarkdownSection from "./components/MarkdownSection";
import ExportButtons from "./components/ExportButtons";
import {
  buildCharacterSheetPrompt,
  buildIllustrationPrompt,
  generateImage,
  generateImageWithReference,
} from "./gemini";
import {
  getApiKey,
  saveApiKey as persistApiKey,
  listStories,
  getStory,
  saveStory,
  deleteStory as deleteStoryDb,
  getImage,
  saveImage,
  newStoryId,
  newImageId,
  createBlankStory,
} from "./db";
import { loadExampleStory } from "./exampleStory";
import "./App.css";

export default function App() {
  /* ---- top-level state ---- */
  const [apiKey, setApiKey] = useState("");
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [storyList, setStoryList] = useState([]); // [{id, title}]
  const [activeStoryId, setActiveStoryId] = useState(null);
  const [story, setStory] = useState(null); // full story record or null
  const [charSheetUrl, setCharSheetUrl] = useState(null);
  const [sectionImages, setSectionImages] = useState({}); // imageId → dataUrl
  const [generatingSheet, setGeneratingSheet] = useState(false);
  const [generatingSections, setGeneratingSections] = useState({});
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const [loadingExample, setLoadingExample] = useState(false);

  const saveTimer = useRef(null);

  /* ---- helpers ---- */

  const characters = useMemo(() => story?.jsonblob?.characters ?? [], [story]);
  const sections = useMemo(() => story?.jsonblob?.sections ?? [], [story]);
  const charSheetImageId = story?.jsonblob?.characterSheetImageId ?? null;

  /** Persist the story (debounced 500 ms). */
  const scheduleSave = useCallback(
    (s) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        try {
          await saveStory(s);
          setStoryList((prev) =>
            prev.map((x) =>
              x.id === s.id ? { ...x, title: s.title } : x
            )
          );
        } catch (err) {
          console.error("auto-save failed", err);
        }
      }, 500);
    },
    []
  );

  /** Update in-memory story and schedule persist. */
  const updateStory = useCallback(
    (fn) => {
      setStory((prev) => {
        if (!prev) return prev;
        const next = typeof fn === "function" ? fn(prev) : { ...prev, ...fn };
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave]
  );

  /* ---- bootstrap ---- */

  useEffect(() => {
    (async () => {
      try {
        const key = await getApiKey();
        if (key) {
          setApiKey(key);
          setApiKeySaved(true);
        }
        const list = await listStories();
        setStoryList(list);
        if (list.length > 0) setActiveStoryId(list[0].id);
      } catch (e) {
        console.error("IndexedDB init error", e);
      }
      setReady(true);
    })();
  }, []);

  /* ---- load active story ---- */

  useEffect(() => {
    if (!activeStoryId) {
      setStory(null);
      setCharSheetUrl(null);
      setSectionImages({});
      return;
    }
    let cancelled = false;
    (async () => {
      const s = await getStory(activeStoryId);
      if (cancelled || !s) return;
      setStory(s);

      // load character sheet image
      if (s.jsonblob.characterSheetImageId) {
        const rec = await getImage(s.jsonblob.characterSheetImageId);
        if (!cancelled) setCharSheetUrl(rec?.data ?? null);
      } else {
        setCharSheetUrl(null);
      }

      // load section images
      const imgMap = {};
      for (const sec of s.jsonblob.sections) {
        if (sec.type === "illustration" && sec.imageId) {
          const rec = await getImage(sec.imageId);
          if (rec) imgMap[sec.imageId] = rec.data;
        }
      }
      if (!cancelled) setSectionImages(imgMap);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeStoryId]);

  /* ---- story CRUD ---- */

  const handleNewStory = useCallback(async () => {
    const id = newStoryId();
    const blank = createBlankStory(id);
    await saveStory(blank);
    setStoryList((prev) => [...prev, { id, title: blank.title }]);
    setActiveStoryId(id);
  }, []);

  const handleDeleteStory = useCallback(async () => {
    if (!activeStoryId) return;
    await deleteStoryDb(activeStoryId);
    const remaining = storyList.filter((s) => s.id !== activeStoryId);
    setStoryList(remaining);
    setStory(null);
    setCharSheetUrl(null);
    setSectionImages({});
    setActiveStoryId(remaining.length > 0 ? remaining[0].id : null);
  }, [activeStoryId, storyList]);

  const handleLoadExample = useCallback(async () => {
    setLoadingExample(true);
    setError(null);
    try {
      const { storyId, story: newStory } = await loadExampleStory();
      setStoryList((prev) => [...prev, { id: storyId, title: newStory.title }]);
      setActiveStoryId(storyId);
    } catch (err) {
      setError("Failed to load example story: " + err.message);
    } finally {
      setLoadingExample(false);
    }
  }, []);

  /* ---- API key ---- */

  const handleSaveApiKey = useCallback(async () => {
    try {
      await persistApiKey(apiKey);
      setApiKeySaved(true);
    } catch (e) {
      setError("Failed to save API key: " + e.message);
    }
  }, [apiKey]);

  const handleApiKeyChange = useCallback((val) => {
    setApiKey(val);
    setApiKeySaved(false);
  }, []);

  /* ---- title ---- */

  const handleTitleChange = useCallback(
    (val) => updateStory((s) => ({ ...s, title: val })),
    [updateStory]
  );

  /* ---- characters ---- */

  const handleCharactersChange = useCallback(
    (chars) =>
      updateStory((s) => ({
        ...s,
        jsonblob: { ...s.jsonblob, characters: chars },
      })),
    [updateStory]
  );

  /* ---- character sheet ---- */

  const handleGenerateSheet = useCallback(async () => {
    if (!story) return;
    setError(null);
    setGeneratingSheet(true);
    try {
      const prompt = buildCharacterSheetPrompt(characters);
      const dataUrl = await generateImage(apiKey, prompt);

      const imgId = newImageId();
      await saveImage({
        id: imgId,
        storyId: story.id,
        caption: "Character sheet",
        data: dataUrl,
        characterReferenceId: null,
      });
      setCharSheetUrl(dataUrl);

      updateStory((s) => ({
        ...s,
        jsonblob: { ...s.jsonblob, characterSheetImageId: imgId },
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setGeneratingSheet(false);
    }
  }, [apiKey, characters, story, updateStory]);

  /* ---- sections ---- */

  const addSection = useCallback(
    (type) => {
      const sec =
        type === "markdown"
          ? { type: "markdown", content: "" }
          : { type: "illustration", caption: "", imageId: null };
      updateStory((s) => ({
        ...s,
        jsonblob: { ...s.jsonblob, sections: [...s.jsonblob.sections, sec] },
      }));
    },
    [updateStory]
  );

  const removeSection = useCallback(
    (idx) =>
      updateStory((s) => ({
        ...s,
        jsonblob: {
          ...s.jsonblob,
          sections: s.jsonblob.sections.filter((_, i) => i !== idx),
        },
      })),
    [updateStory]
  );

  const updateSectionField = useCallback(
    (idx, field, value) =>
      updateStory((s) => ({
        ...s,
        jsonblob: {
          ...s.jsonblob,
          sections: s.jsonblob.sections.map((sec, i) =>
            i === idx ? { ...sec, [field]: value } : sec
          ),
        },
      })),
    [updateStory]
  );

  const handleGenerateIllustration = useCallback(
    async (idx) => {
      if (!story) return;
      setError(null);
      setGeneratingSections((prev) => ({ ...prev, [idx]: true }));

      try {
        const caption = sections[idx]?.caption;
        const prompt = buildIllustrationPrompt(characters, caption);

        const base64 = charSheetUrl.split(",")[1];
        const mimeType = charSheetUrl.split(";")[0].split(":")[1];

        const dataUrl = await generateImageWithReference(
          apiKey,
          prompt,
          base64,
          mimeType
        );

        const imgId = newImageId();
        await saveImage({
          id: imgId,
          storyId: story.id,
          caption,
          data: dataUrl,
          characterReferenceId: charSheetImageId,
        });

        setSectionImages((prev) => ({ ...prev, [imgId]: dataUrl }));
        updateSectionField(idx, "imageId", imgId);
      } catch (err) {
        setError(err.message);
      } finally {
        setGeneratingSections((prev) => ({ ...prev, [idx]: false }));
      }
    },
    [
      apiKey,
      characters,
      charSheetUrl,
      charSheetImageId,
      sections,
      story,
      updateSectionField,
    ]
  );

  /* ---- render ---- */

  if (!ready) return null; // waiting for DB

  return (
    <div className="app-shell">
      <Navbar
        stories={storyList}
        activeStoryId={activeStoryId}
        onSelectStory={setActiveStoryId}
        onNewStory={handleNewStory}
        onDeleteStory={handleDeleteStory}
        onLoadExample={handleLoadExample}
        loadingExample={loadingExample}
      />

      <div className="app">
        <main>
          <ApiKeyInput
            apiKey={apiKey}
            onApiKeyChange={handleApiKeyChange}
            onSaveKey={handleSaveApiKey}
            saved={apiKeySaved}
          />

          {!story && (
            <div className="card" style={{ textAlign: "center" }}>
              <p>Create or select a story to get started.</p>
              <button
                type="button"
                className="btn-primary"
                onClick={handleNewStory}
              >
                + New Story
              </button>
            </div>
          )}

          {story && (
            <>
              {/* Story title */}
              <section className="card">
                <label htmlFor="story-title" style={{ fontWeight: 600 }}>
                  Story Title
                </label>
                <input
                  id="story-title"
                  type="text"
                  className="caption-input"
                  value={story.title}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  placeholder="Give your story a title"
                />
              </section>

              {/* Character editor */}
              <CharacterEditor
                characters={characters}
                onCharactersChange={handleCharactersChange}
                onGenerate={handleGenerateSheet}
                characterSheetUrl={charSheetUrl}
                generating={generatingSheet}
                disabled={!apiKey.trim()}
              />

              {/* Sections */}
              <section className="card">
                <h2>📚 Story Sections</h2>
                <p className="section-description">
                  Add text blocks and illustration pages. The AI uses your
                  character sheet to keep characters consistent.
                </p>

                {sections.map((sec, idx) =>
                  sec.type === "markdown" ? (
                    <MarkdownSection
                      key={idx}
                      index={idx}
                      content={sec.content}
                      onContentChange={(val) =>
                        updateSectionField(idx, "content", val)
                      }
                      onRemove={() => removeSection(idx)}
                    />
                  ) : (
                    <Illustration
                      key={idx}
                      index={idx}
                      caption={sec.caption}
                      imageUrl={
                        sec.imageId ? sectionImages[sec.imageId] ?? null : null
                      }
                      generating={!!generatingSections[idx]}
                      onCaptionChange={(val) =>
                        updateSectionField(idx, "caption", val)
                      }
                      onGenerate={() => handleGenerateIllustration(idx)}
                      onRemove={() => removeSection(idx)}
                      disabled={!charSheetUrl}
                    />
                  )
                )}

                <div className="add-section-row">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => addSection("markdown")}
                  >
                    📝 Add Text
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => addSection("illustration")}
                  >
                    🖼️ Add Illustration
                  </button>
                </div>
              </section>

              {/* Export */}
              <ExportButtons story={story} />
            </>
          )}

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
    </div>
  );
}
