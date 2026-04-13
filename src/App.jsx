import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import AgeGate from "./components/AgeGate";
import { hasRecentAgreement } from "./ageGateStore";
import Navbar from "./components/Navbar";
import ApiKeyInput from "./components/ApiKeyInput";
import StyleEditor from "./components/StyleEditor";
import ReferenceGraphics from "./components/ReferenceGraphics";
import Illustration from "./components/Illustration";
import IllustrationPlanModal from "./components/IllustrationPlanModal";
import MarkdownSection from "./components/MarkdownSection";
import ExportButtons from "./components/ExportButtons";
import {
  buildRefGraphicPrompt,
  planIllustration,
  generateImage,
  generateImageWithReferences,
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
  migrateStory,
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
  const [allImages, setAllImages] = useState({}); // imageId → dataUrl
  const [generatingRefIds, setGeneratingRefIds] = useState({});
  const [generatingSections, setGeneratingSections] = useState({});
  const [planningSections, setPlanningSections] = useState({});
  const [illustrationPlan, setIllustrationPlan] = useState(null); // { idx, prompt, referenceImageIds }
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const [loadingExample, setLoadingExample] = useState(false);
  const [ageAgreed, setAgeAgreed] = useState(() => hasRecentAgreement());

  const dirtyStoryRef = useRef(null);
  const saveTimerRef = useRef(null);

  /* ---- helpers ---- */

  const style = useMemo(() => story?.jsonblob?.style ?? "", [story]);
  const sections = useMemo(() => story?.jsonblob?.sections ?? [], [story]);
  const referenceGraphics = useMemo(
    () => story?.jsonblob?.referenceGraphics ?? [],
    [story]
  );

  /**
   * Immediately persist whatever is in dirtyStoryRef and clear it.
   * Safe to call even when nothing is dirty.
   */
  const flushSave = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const s = dirtyStoryRef.current;
    if (!s) return;
    dirtyStoryRef.current = null;
    try {
      await saveStory(s);
      setStoryList((prev) =>
        prev.map((x) => (x.id === s.id ? { ...x, title: s.title } : x))
      );
    } catch (err) {
      console.error("auto-save failed", err);
    }
  }, []);

  /** Mark story dirty and schedule a deferred persist (500 ms). */
  const scheduleSave = useCallback(
    (s) => {
      dirtyStoryRef.current = s;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        flushSave();
      }, 500);
    },
    [flushSave]
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

  /* ---- flush on tab hide / page unload / blur ---- */

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") flushSave();
    };
    const handleBlur = () => flushSave();
    const handleBeforeUnload = () => {
      // Best-effort fire-and-forget; visibilitychange (hidden) fires first
      // in most browsers, so this is a safety net.
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const s = dirtyStoryRef.current;
      if (s) {
        dirtyStoryRef.current = null;
        saveStory(s).catch(() => {});
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      // Best-effort flush on unmount (async, may not complete if React
      // tears down synchronously, but the beforeunload/visibility handlers
      // cover the tab-close path).
      flushSave();
    };
  }, [flushSave]);

  /* ---- load active story ---- */

  useEffect(() => {
    if (!activeStoryId) {
      setStory(null);
      setAllImages({});
      return;
    }
    let cancelled = false;
    (async () => {
      let s = await getStory(activeStoryId);
      if (cancelled || !s) return;

      // Migrate legacy stories
      s = migrateStory(s);

      setStory(s);

      // Load all images referenced by the story
      const imgMap = {};

      // Reference graphic images
      for (const rg of s.jsonblob.referenceGraphics ?? []) {
        if (rg.imageId) {
          const rec = await getImage(rg.imageId);
          if (rec) imgMap[rg.imageId] = rec.data;
        }
      }

      // Section illustration images
      for (const sec of s.jsonblob.sections) {
        if (sec.type === "illustration" && sec.imageId) {
          const rec = await getImage(sec.imageId);
          if (rec) imgMap[sec.imageId] = rec.data;
        }
      }
      if (!cancelled) setAllImages(imgMap);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeStoryId]);

  /* ---- story CRUD ---- */

  /** Flush pending save before switching to a different story. */
  const handleSelectStory = useCallback(
    async (id) => {
      await flushSave();
      setActiveStoryId(id);
    },
    [flushSave]
  );

  const handleNewStory = useCallback(async () => {
    await flushSave();
    const id = newStoryId();
    const blank = createBlankStory(id);
    await saveStory(blank);
    setStoryList((prev) => [...prev, { id, title: blank.title }]);
    setActiveStoryId(id);
  }, [flushSave]);

  const handleDeleteStory = useCallback(async () => {
    if (!activeStoryId) return;
    // Discard any pending save for the story we are about to delete
    if (dirtyStoryRef.current?.id === activeStoryId) {
      dirtyStoryRef.current = null;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    }
    await deleteStoryDb(activeStoryId);
    const remaining = storyList.filter((s) => s.id !== activeStoryId);
    setStoryList(remaining);
    setStory(null);
    setAllImages({});
    setActiveStoryId(remaining.length > 0 ? remaining[0].id : null);
  }, [activeStoryId, storyList]);

  const handleLoadExample = useCallback(async () => {
    await flushSave();
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
  }, [flushSave]);

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

  /* ---- style ---- */

  const handleStyleChange = useCallback(
    (val) =>
      updateStory((s) => ({
        ...s,
        jsonblob: { ...s.jsonblob, style: val },
      })),
    [updateStory]
  );

  /* ---- reference graphics ---- */

  const handleAddRefGraphic = useCallback(() => {
    const id = crypto.randomUUID();
    updateStory((s) => ({
      ...s,
      jsonblob: {
        ...s.jsonblob,
        referenceGraphics: [
          ...s.jsonblob.referenceGraphics,
          { id, label: "", kind: "character", imageId: null, prompt: "" },
        ],
      },
    }));
  }, [updateStory]);

  const handleRemoveRefGraphic = useCallback(
    (rgId) =>
      updateStory((s) => ({
        ...s,
        jsonblob: {
          ...s.jsonblob,
          referenceGraphics: s.jsonblob.referenceGraphics.filter(
            (rg) => rg.id !== rgId
          ),
        },
      })),
    [updateStory]
  );

  const handleUpdateRefLabel = useCallback(
    (rgId, label) =>
      updateStory((s) => ({
        ...s,
        jsonblob: {
          ...s.jsonblob,
          referenceGraphics: s.jsonblob.referenceGraphics.map((rg) =>
            rg.id === rgId ? { ...rg, label } : rg
          ),
        },
      })),
    [updateStory]
  );

  const handleUpdateRefKind = useCallback(
    (rgId, kind) =>
      updateStory((s) => ({
        ...s,
        jsonblob: {
          ...s.jsonblob,
          referenceGraphics: s.jsonblob.referenceGraphics.map((rg) =>
            rg.id === rgId ? { ...rg, kind } : rg
          ),
        },
      })),
    [updateStory]
  );

  const handleGenerateRefGraphic = useCallback(
    async (rgId, kind, userPrompt, imageModel, label) => {
      if (!story) return;
      setError(null);
      setGeneratingRefIds((prev) => ({ ...prev, [rgId]: true }));
      try {
        const prompt = buildRefGraphicPrompt(style, kind, userPrompt, label);
        const dataUrl = await generateImage(apiKey, prompt, imageModel);
        const imgId = newImageId();
        await saveImage({
          id: imgId,
          storyId: story.id,
          caption: userPrompt.slice(0, 120),
          data: dataUrl,
        });
        setAllImages((prev) => ({ ...prev, [imgId]: dataUrl }));

        updateStory((s) => ({
          ...s,
          jsonblob: {
            ...s.jsonblob,
            referenceGraphics: s.jsonblob.referenceGraphics.map((rg) =>
              rg.id === rgId
                ? { ...rg, imageId: imgId, prompt: userPrompt }
                : rg
            ),
          },
        }));
      } catch (err) {
        setError(err.message);
      } finally {
        setGeneratingRefIds((prev) => ({ ...prev, [rgId]: false }));
      }
    },
    [apiKey, style, story, updateStory]
  );

  const handleUploadRefGraphic = useCallback(
    async (rgId, dataUrl) => {
      if (!story) return;
      setError(null);
      try {
        const imgId = newImageId();
        await saveImage({
          id: imgId,
          storyId: story.id,
          caption: "Uploaded reference",
          data: dataUrl,
        });
        setAllImages((prev) => ({ ...prev, [imgId]: dataUrl }));

        updateStory((s) => ({
          ...s,
          jsonblob: {
            ...s.jsonblob,
            referenceGraphics: s.jsonblob.referenceGraphics.map((rg) =>
              rg.id === rgId ? { ...rg, imageId: imgId } : rg
            ),
          },
        }));
      } catch (err) {
        setError(err.message);
      }
    },
    [story, updateStory]
  );

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

  const moveSection = useCallback(
    (idx, direction) => {
      const target = idx + direction;
      updateStory((s) => {
        const secs = [...s.jsonblob.sections];
        if (target < 0 || target >= secs.length) return s;
        [secs[idx], secs[target]] = [secs[target], secs[idx]];
        return { ...s, jsonblob: { ...s.jsonblob, sections: secs } };
      });
    },
    [updateStory]
  );

  /* ---- illustration plan → approve → generate ---- */

  const handlePlanIllustration = useCallback(
    async (idx, textModel) => {
      if (!story) return;
      setError(null);
      setPlanningSections((prev) => ({ ...prev, [idx]: true }));

      try {
        const caption = sections[idx]?.caption;
        const plan = await planIllustration(
          apiKey,
          style,
          referenceGraphics,
          sections,
          caption,
          allImages,
          textModel
        );
        setIllustrationPlan({ idx, ...plan });
      } catch (err) {
        setError(err.message);
      } finally {
        setPlanningSections((prev) => ({ ...prev, [idx]: false }));
      }
    },
    [apiKey, allImages, style, referenceGraphics, sections, story]
  );

  const handleApproveIllustration = useCallback(
    async (approvedPlan) => {
      const idx = illustrationPlan.idx;
      setIllustrationPlan(null);
      if (!story) return;
      setError(null);
      setGeneratingSections((prev) => ({ ...prev, [idx]: true }));

      try {
        // Collect reference images from approved plan
        const refImgs = [];
        for (const imgId of approvedPlan.referenceImageIds) {
          const dataUrl = allImages[imgId];
          if (dataUrl) {
            const base64 = dataUrl.split(",")[1];
            const mimeType = dataUrl.split(";")[0].split(":")[1];
            refImgs.push({ base64, mimeType });
          }
        }

        const dataUrl = await generateImageWithReferences(
          apiKey,
          approvedPlan.prompt,
          refImgs,
          approvedPlan.imageModel
        );

        const imgId = newImageId();
        const caption = sections[idx]?.caption;
        await saveImage({
          id: imgId,
          storyId: story.id,
          caption,
          data: dataUrl,
        });

        setAllImages((prev) => ({ ...prev, [imgId]: dataUrl }));
        updateSectionField(idx, "imageId", imgId);
      } catch (err) {
        setError(err.message);
      } finally {
        setGeneratingSections((prev) => ({ ...prev, [idx]: false }));
      }
    },
    [
      apiKey,
      allImages,
      illustrationPlan,
      sections,
      story,
      updateSectionField,
    ]
  );

  const handleCancelPlan = useCallback(() => setIllustrationPlan(null), []);

  /* ---- render ---- */

  if (!ready) return null; // waiting for DB

  if (!ageAgreed) {
    return <AgeGate onAccept={() => setAgeAgreed(true)} />;
  }

  return (
    <div className="app-shell">
      <Navbar
        stories={storyList}
        activeStoryId={activeStoryId}
        onSelectStory={handleSelectStory}
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

              {/* Style editor */}
              <StyleEditor
                style={style}
                onStyleChange={handleStyleChange}
              />

              {/* Reference Graphics */}
              <ReferenceGraphics
                referenceGraphics={referenceGraphics}
                refImages={allImages}
                onAdd={handleAddRefGraphic}
                onRemove={handleRemoveRefGraphic}
                onUpdateLabel={handleUpdateRefLabel}
                onUpdateKind={handleUpdateRefKind}
                onGenerate={handleGenerateRefGraphic}
                onUpload={handleUploadRefGraphic}
                generatingIds={generatingRefIds}
                disabled={!apiKey.trim()}
              />

              {/* Sections */}
              <section className="card">
                <h2>📚 Story Sections</h2>
                <p className="section-description">
                  Add text blocks and illustration pages. The AI uses your
                  reference graphics to keep characters consistent.
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
                      onMoveUp={idx > 0 ? () => moveSection(idx, -1) : null}
                      onMoveDown={idx < sections.length - 1 ? () => moveSection(idx, 1) : null}
                    />
                  ) : (
                    <Illustration
                      key={idx}
                      index={idx}
                      caption={sec.caption}
                      imageUrl={
                        sec.imageId ? allImages[sec.imageId] ?? null : null
                      }
                      generating={!!generatingSections[idx]}
                      planning={!!planningSections[idx]}
                      onCaptionChange={(val) =>
                        updateSectionField(idx, "caption", val)
                      }
                      onPlanIllustration={(textModel) => handlePlanIllustration(idx, textModel)}
                      onRemove={() => removeSection(idx)}
                      onMoveUp={idx > 0 ? () => moveSection(idx, -1) : null}
                      onMoveDown={idx < sections.length - 1 ? () => moveSection(idx, 1) : null}
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

      {/* Illustration plan approval modal */}
      {illustrationPlan && (
        <IllustrationPlanModal
          plan={illustrationPlan}
          allImages={allImages}
          referenceGraphics={referenceGraphics}
          sections={sections}
          onApprove={handleApproveIllustration}
          onCancel={handleCancelPlan}
        />
      )}
    </div>
  );
}
