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
import ConfirmDialog from "./components/ConfirmDialog";
import UndoToast from "./components/UndoToast";
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
  restoreStory,
  getImage,
  saveImage,
  newStoryId,
  newImageId,
  newSectionId,
  createBlankStory,
  migrateStory,
} from "./db";
import { loadExampleStory } from "./exampleStory";
import "./App.css";

/** Heading a section shows on its card, used in undo/confirm copy. */
function sectionTitle(sec, index) {
  return sec.type === "illustration"
    ? `Page ${index + 1}`
    : `Text Block ${index + 1}`;
}

/**
 * Dialog copy for a pending destructive action.
 *
 * Deleting a story is the big one — it takes every image with it and there is
 * no server copy — so it asks the user to type the title back. Removing a
 * single panel is a far smaller loss, so it only interrupts when there is
 * artwork to lose, and never asks anyone to type anything.
 */
function confirmProps(pending) {
  if (pending.kind === "story") {
    const title = pending.title || "Untitled";
    return {
      title: "Delete this story?",
      confirmLabel: "🗑️ Delete story",
      confirmPhrase: title,
      phraseLabel: (
        <>
          Type the story title —{" "}
          <code className="confirm-phrase">{title}</code> — to confirm
        </>
      ),
      message: (
        <>
          <p>
            <strong>{title}</strong> will be removed from this browser
            {pending.imageCount > 0 && (
              <>
                , along with{" "}
                <strong>
                  {pending.imageCount} generated image
                  {pending.imageCount === 1 ? "" : "s"}
                </strong>
              </>
            )}
            .
          </p>
          <p className="confirm-note">
            Stories live only in this browser, so there is no copy on a server
            to fall back on. You will get a short window to undo — after that it
            is gone for good. Export first if you want to keep it.
          </p>
        </>
      ),
    };
  }

  if (pending.kind === "section") {
    return {
      title: "Remove this page?",
      confirmLabel: "🗑️ Remove page",
      message: (
        <>
          <p>
            <strong>{pending.title}</strong> has an illustration you generated.
            Removing the page takes the picture out of the story with it.
          </p>
          <p className="confirm-note">
            You will get a few seconds to undo. After that, getting this picture
            back means generating it again.
          </p>
        </>
      ),
    };
  }

  return {
    title: "Remove this reference graphic?",
    confirmLabel: "🗑️ Remove reference",
    message: (
      <>
        <p>
          <strong>{pending.label}</strong> has an image. Removing it means new
          illustrations will no longer use it to keep characters and scenes
          looking consistent.
        </p>
        <p className="confirm-note">
          You will get a few seconds to undo. After that, getting this image
          back means generating or uploading it again.
        </p>
      </>
    ),
  };
}

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
  const [illustrationPlan, setIllustrationPlan] = useState(null); // { sectionId, prompt, referenceImageIds }
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const [loadingExample, setLoadingExample] = useState(false);
  const [confirm, setConfirm] = useState(null); // pending destructive action
  const [undo, setUndo] = useState(null); // last reversible deletion
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
    // A panel-level undo only makes sense while its own story is on screen.
    // A story-level undo has to outlive the switch away from the deleted story.
    setUndo((prev) => (prev && prev.kind !== "story" ? null : prev));

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

  /** Ask for confirmation before deleting — deletion wipes images too. */
  const handleRequestDeleteStory = useCallback(() => {
    if (!activeStoryId) return;
    const entry = storyList.find((s) => s.id === activeStoryId);
    setConfirm({
      kind: "story",
      id: activeStoryId,
      title: entry?.title || story?.title || "Untitled",
      imageCount: Object.keys(allImages).length,
    });
  }, [activeStoryId, allImages, story, storyList]);

  const deleteStoryNow = useCallback(
    async (id, title) => {
      // Discard any pending save for the story we are about to delete
      if (dirtyStoryRef.current?.id === id) {
        dirtyStoryRef.current = null;
        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }
      }
      const index = storyList.findIndex((s) => s.id === id);
      const snapshot = await deleteStoryDb(id);
      const remaining = storyList.filter((s) => s.id !== id);
      setStoryList(remaining);
      setUndo({
        undoId: crypto.randomUUID(),
        kind: "story",
        message: `Deleted "${title || "Untitled"}"`,
        snapshot,
        index: index === -1 ? remaining.length : index,
      });
      if (activeStoryId === id) {
        setStory(null);
        setAllImages({});
        setActiveStoryId(remaining.length > 0 ? remaining[0].id : null);
      }
    },
    [activeStoryId, storyList]
  );

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

  /** Remove a reference graphic, keeping a snapshot the toast can put back. */
  const removeRefGraphicNow = useCallback(
    (rgId) => {
      const index = referenceGraphics.findIndex((rg) => rg.id === rgId);
      if (index === -1 || !story) return;
      const removed = referenceGraphics[index];
      updateStory((s) => ({
        ...s,
        jsonblob: {
          ...s.jsonblob,
          referenceGraphics: s.jsonblob.referenceGraphics.filter(
            (rg) => rg.id !== rgId
          ),
        },
      }));
      setUndo({
        undoId: crypto.randomUUID(),
        kind: "refGraphic",
        storyId: story.id,
        message: `Removed reference "${removed.label || "unlabeled"}"`,
        refGraphic: removed,
        index,
      });
    },
    [referenceGraphics, story, updateStory]
  );

  /** ✕ on a reference graphic: ask first when there is an image to lose. */
  const handleRemoveRefGraphic = useCallback(
    (rgId) => {
      const rg = referenceGraphics.find((x) => x.id === rgId);
      if (!rg) return;
      if (rg.imageId) {
        setConfirm({
          kind: "refGraphic",
          rgId,
          label: rg.label || "This reference graphic",
        });
      } else {
        removeRefGraphicNow(rgId);
      }
    },
    [referenceGraphics, removeRefGraphicNow]
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
      const id = newSectionId();
      const sec =
        type === "markdown"
          ? { id, type: "markdown", content: "" }
          : { id, type: "illustration", caption: "", imageId: null };
      updateStory((s) => ({
        ...s,
        jsonblob: { ...s.jsonblob, sections: [...s.jsonblob.sections, sec] },
      }));
    },
    [updateStory]
  );

  /** Remove a section, keeping a snapshot the toast can put back. */
  const removeSectionNow = useCallback(
    (sectionId) => {
      const index = sections.findIndex((sec) => sec.id === sectionId);
      if (index === -1 || !story) return;
      const removed = sections[index];
      updateStory((s) => ({
        ...s,
        jsonblob: {
          ...s.jsonblob,
          sections: s.jsonblob.sections.filter((sec) => sec.id !== sectionId),
        },
      }));
      setUndo({
        undoId: crypto.randomUUID(),
        kind: "section",
        storyId: story.id,
        message: `Removed ${sectionTitle(removed, index)}`,
        section: removed,
        index,
      });
    },
    [sections, story, updateStory]
  );

  /** ✕ on a section: ask first when there is a generated illustration to lose. */
  const handleRemoveSection = useCallback(
    (sectionId) => {
      const index = sections.findIndex((sec) => sec.id === sectionId);
      if (index === -1) return;
      const sec = sections[index];
      if (sec.type === "illustration" && sec.imageId) {
        setConfirm({
          kind: "section",
          sectionId,
          title: sectionTitle(sec, index),
        });
      } else {
        removeSectionNow(sectionId);
      }
    },
    [removeSectionNow, sections]
  );

  /**
   * Sections are addressed by id, never by position, so an update that was
   * kicked off before a removal or reorder can never land on a different panel.
   * When the target is gone the update is simply dropped.
   */
  const updateSectionField = useCallback(
    (sectionId, field, value) =>
      updateStory((s) => {
        if (!s.jsonblob.sections.some((sec) => sec.id === sectionId)) return s;
        return {
          ...s,
          jsonblob: {
            ...s.jsonblob,
            sections: s.jsonblob.sections.map((sec) =>
              sec.id === sectionId ? { ...sec, [field]: value } : sec
            ),
          },
        };
      }),
    [updateStory]
  );

  const moveSection = useCallback(
    (sectionId, direction) => {
      updateStory((s) => {
        const secs = [...s.jsonblob.sections];
        const idx = secs.findIndex((sec) => sec.id === sectionId);
        if (idx === -1) return s;
        const target = idx + direction;
        if (target < 0 || target >= secs.length) return s;
        [secs[idx], secs[target]] = [secs[target], secs[idx]];
        return { ...s, jsonblob: { ...s.jsonblob, sections: secs } };
      });
    },
    [updateStory]
  );

  /* ---- confirm / undo dispatch ---- */

  const handleCancelConfirm = useCallback(() => setConfirm(null), []);

  const handleAcceptConfirm = useCallback(() => {
    if (!confirm) return;
    const pending = confirm;
    setConfirm(null);
    if (pending.kind === "story") deleteStoryNow(pending.id, pending.title);
    else if (pending.kind === "section") removeSectionNow(pending.sectionId);
    else if (pending.kind === "refGraphic") removeRefGraphicNow(pending.rgId);
  }, [confirm, deleteStoryNow, removeRefGraphicNow, removeSectionNow]);

  const handleDismissUndo = useCallback(() => setUndo(null), []);

  /** Put back whatever the last deletion took, at the position it held. */
  const handleUndo = useCallback(async () => {
    if (!undo) return;
    const pending = undo;
    setUndo(null);

    if (pending.kind === "story") {
      if (!pending.snapshot?.story) return;
      await restoreStory(pending.snapshot);
      const entry = {
        id: pending.snapshot.story.id,
        title: pending.snapshot.story.title,
      };
      setStoryList((prev) => {
        if (prev.some((s) => s.id === entry.id)) return prev;
        const next = [...prev];
        next.splice(Math.min(pending.index, next.length), 0, entry);
        return next;
      });
      await flushSave();
      setActiveStoryId(entry.id);
      return;
    }

    const key = pending.kind === "section" ? "sections" : "referenceGraphics";
    const item =
      pending.kind === "section" ? pending.section : pending.refGraphic;

    updateStory((s) => {
      // Guard against the story having been switched out from under the toast.
      if (s.id !== pending.storyId) return s;
      const list = s.jsonblob[key];
      if (list.some((x) => x.id === item.id)) return s;
      const next = [...list];
      next.splice(Math.min(pending.index, next.length), 0, item);
      return { ...s, jsonblob: { ...s.jsonblob, [key]: next } };
    });
  }, [flushSave, undo, updateStory]);

  /* ---- illustration plan → generate ---- */

  /**
   * Ask the model to plan the illustration for a section.
   * Returns the plan, or null if planning failed (error is surfaced).
   */
  const runPlan = useCallback(
    async (sectionId, textModel) => {
      const sec = sections.find((x) => x.id === sectionId);
      if (!sec) return null;
      setError(null);
      setPlanningSections((prev) => ({ ...prev, [sectionId]: true }));
      try {
        return await planIllustration(
          apiKey,
          style,
          referenceGraphics,
          sections,
          sec.caption,
          allImages,
          textModel
        );
      } catch (err) {
        setError(err.message);
        return null;
      } finally {
        setPlanningSections((prev) => ({ ...prev, [sectionId]: false }));
      }
    },
    [apiKey, allImages, style, referenceGraphics, sections]
  );

  /** Generate + persist the image for a section from a finished plan. */
  const runGenerate = useCallback(
    async (sectionId, plan) => {
      if (!story) return;
      setError(null);
      setGeneratingSections((prev) => ({ ...prev, [sectionId]: true }));

      try {
        // Collect reference images from the plan
        const refImgs = [];
        for (const imgId of plan.referenceImageIds) {
          const dataUrl = allImages[imgId];
          if (dataUrl) {
            const base64 = dataUrl.split(",")[1];
            const mimeType = dataUrl.split(";")[0].split(":")[1];
            refImgs.push({ base64, mimeType });
          }
        }

        const dataUrl = await generateImageWithReferences(
          apiKey,
          plan.prompt,
          refImgs,
          plan.imageModel
        );

        const imgId = newImageId();
        const caption = sections.find((x) => x.id === sectionId)?.caption;
        await saveImage({
          id: imgId,
          storyId: story.id,
          caption,
          data: dataUrl,
        });

        setAllImages((prev) => ({ ...prev, [imgId]: dataUrl }));
        // Dropped harmlessly if the page was removed while this was in flight.
        updateSectionField(sectionId, "imageId", imgId);
      } catch (err) {
        setError(err.message);
      } finally {
        setGeneratingSections((prev) => ({ ...prev, [sectionId]: false }));
      }
    },
    [apiKey, allImages, sections, story, updateSectionField]
  );

  /** Plan only, then open the review modal. */
  const handlePlanIllustration = useCallback(
    async (sectionId, textModel) => {
      if (!story) return;
      const plan = await runPlan(sectionId, textModel);
      if (plan) setIllustrationPlan({ sectionId, ...plan });
    },
    [runPlan, story]
  );

  /** One-shot: plan and immediately generate, skipping the review modal. */
  const handleGenerateIllustration = useCallback(
    async (sectionId, textModel, imageModel) => {
      if (!story) return;
      const plan = await runPlan(sectionId, textModel);
      if (plan) await runGenerate(sectionId, { ...plan, imageModel });
    },
    [runGenerate, runPlan, story]
  );

  const handleApproveIllustration = useCallback(
    async (approvedPlan) => {
      const { sectionId } = illustrationPlan;
      setIllustrationPlan(null);
      await runGenerate(sectionId, approvedPlan);
    },
    [illustrationPlan, runGenerate]
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
        onDeleteStory={handleRequestDeleteStory}
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
                      key={sec.id}
                      index={idx}
                      content={sec.content}
                      onContentChange={(val) =>
                        updateSectionField(sec.id, "content", val)
                      }
                      onRemove={() => handleRemoveSection(sec.id)}
                      onMoveUp={idx > 0 ? () => moveSection(sec.id, -1) : null}
                      onMoveDown={
                        idx < sections.length - 1
                          ? () => moveSection(sec.id, 1)
                          : null
                      }
                    />
                  ) : (
                    <Illustration
                      key={sec.id}
                      index={idx}
                      caption={sec.caption}
                      imageUrl={
                        sec.imageId ? allImages[sec.imageId] ?? null : null
                      }
                      generating={!!generatingSections[sec.id]}
                      planning={!!planningSections[sec.id]}
                      onCaptionChange={(val) =>
                        updateSectionField(sec.id, "caption", val)
                      }
                      onGenerateIllustration={(textModel, imageModel) =>
                        handleGenerateIllustration(sec.id, textModel, imageModel)
                      }
                      onPlanIllustration={(textModel) =>
                        handlePlanIllustration(sec.id, textModel)
                      }
                      onRemove={() => handleRemoveSection(sec.id)}
                      onMoveUp={idx > 0 ? () => moveSection(sec.id, -1) : null}
                      onMoveDown={
                        idx < sections.length - 1
                          ? () => moveSection(sec.id, 1)
                          : null
                      }
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

      {/* Confirmation for the destructive actions that can actually lose work */}
      {confirm && (
        <ConfirmDialog
          {...confirmProps(confirm)}
          onConfirm={handleAcceptConfirm}
          onCancel={handleCancelConfirm}
        />
      )}

      {/* Undo window after a deletion */}
      {undo && (
        <UndoToast
          key={undo.undoId}
          message={undo.message}
          onUndo={handleUndo}
          onDismiss={handleDismissUndo}
        />
      )}
    </div>
  );
}
