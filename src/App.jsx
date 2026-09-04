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
import SectionIndex from "./components/SectionIndex";
import ExportButtons from "./components/ExportButtons";
import ConfirmDialog from "./components/ConfirmDialog";
import UndoToast from "./components/UndoToast";
import TrashBin from "./components/TrashBin";
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
  saveStoryWithImages,
  deleteStory as deleteStoryDb,
  restoreStory,
  getImage,
  saveImage,
  newStoryId,
  newImageId,
  newSectionId,
  createBlankStory,
  migrateStory,
  trashImage,
  untrashImage,
  listTrash,
  countTrash,
  deleteTrashedImage,
  emptyTrash,
} from "./db";
import { loadExampleStory } from "./exampleStory";
import useSectionShortcuts from "./useSectionShortcuts";
import scrollIntoViewFully from "./scrollIntoViewFully";
import {
  readStoryBundle,
  prepareForImport,
  collectImageIds,
} from "./storyBundle";
import "./App.css";

/** Heading a section shows on its card, used in undo/confirm copy. */
function sectionTitle(sec, index) {
  return sec.type === "illustration"
    ? `Page ${index + 1}`
    : `Text Block ${index + 1}`;
}

/** Warning shown above a plan the model didn't deliver cleanly. */
function planNotice(plan) {
  return plan.partial
    ? "The planner's reply arrived damaged, so this prompt was recovered from " +
        "the part that did come through. Read it over — and re-check the " +
        "reference images — before generating."
    : null;
}

/**
 * Dialog copy for a pending destructive action.
 *
 * Deleting a story is the big one — it takes every image with it and there is
 * no server copy — so it asks the user to type the title back. Removing a
 * single panel is a far smaller loss, so it only interrupts when there is
 * artwork to lose, and never asks anyone to type anything.
 *
 * Emptying the trash is the only action here that actually destroys a
 * picture, so it asks for typing too.
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
            to fall back on. You will get a short window to undo — after that
            the story itself is gone for good, though its pictures wait in the
            trash until you empty it. Export first if you want to keep it.
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
            You will get a few seconds to undo. After that the picture waits in
            the trash, where you can put it back or throw it away for good.
          </p>
        </>
      ),
    };
  }

  if (pending.kind === "refGraphic") {
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
            You will get a few seconds to undo. After that the image waits in
            the trash, where you can put it back or throw it away for good.
          </p>
        </>
      ),
    };
  }

  if (pending.kind === "trashItem") {
    return {
      title: "Throw this picture away for good?",
      confirmLabel: "✕ Delete forever",
      message: (
        <>
          <p>
            <strong>{pending.label || "This picture"}</strong> will be gone from
            this browser for good. Nothing puts it back.
          </p>
          <p className="confirm-note">
            The rest of the trash is untouched.
          </p>
        </>
      ),
    };
  }

  const count = pending.count ?? 0;
  return {
    title: "Empty the trash?",
    confirmLabel: "🧹 Empty trash",
    confirmPhrase: "empty",
    phraseLabel: (
      <>
        Type <code className="confirm-phrase">empty</code> to confirm
      </>
    ),
    message: (
      <>
        <p>
          All{" "}
          <strong>
            {count} picture{count === 1 ? "" : "s"}
          </strong>{" "}
          in the trash will be gone from this browser for good. Each one is a
          generation you paid for, and nothing puts them back.
        </p>
        <p className="confirm-note">
          Any undo still on offer goes with them. Put back anything you want to
          keep before emptying.
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
  const [activeSectionId, setActiveSectionId] = useState(null); // section on screen
  const [story, setStory] = useState(null); // full story record or null
  const [allImages, setAllImages] = useState({}); // imageId → dataUrl
  const [generatingRefIds, setGeneratingRefIds] = useState({});
  const [generatingSections, setGeneratingSections] = useState({});
  const [planningSections, setPlanningSections] = useState({});
  const [illustrationPlan, setIllustrationPlan] = useState(null); // { sectionId, prompt, referenceImageIds }
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const [loadingExample, setLoadingExample] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState(null);
  const [confirm, setConfirm] = useState(null); // pending destructive action
  const [undo, setUndo] = useState(null); // last reversible deletion
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashItems, setTrashItems] = useState([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashCount, setTrashCount] = useState(0); // badge on the navbar
  const [trashBusyId, setTrashBusyId] = useState(null); // one item mid-action
  const [trashPickSectionId, setTrashPickSectionId] = useState(null); // picker
  const [ageAgreed, setAgeAgreed] = useState(() => hasRecentAgreement());
  const [revealRequest, setRevealRequest] = useState(null); // { id } to show

  const dirtyStoryRef = useRef(null);
  const saveTimerRef = useRef(null);
  const navbarHeightRef = useRef(0); // how much of the top the sticky bar covers
  const editorRef = useRef(null); // the one open section, on screen
  const revealedRef = useRef(null); // section the last page turn aimed at

  /* ---- helpers ---- */

  const style = useMemo(() => story?.jsonblob?.style ?? "", [story]);
  const sections = useMemo(() => story?.jsonblob?.sections ?? [], [story]);
  const referenceGraphics = useMemo(
    () => story?.jsonblob?.referenceGraphics ?? [],
    [story]
  );

  /**
   * The section being edited.
   *
   * Only this one is rendered — a story can run to seventy pages, and mounting
   * all of them means every keystroke re-renders every card and every
   * illustration sits decoded in memory at once. Falls back to the first
   * section whenever the selection points at something that is no longer
   * there (a removal, a story switch, an import).
   */
  const activeIndex = useMemo(() => {
    const i = sections.findIndex((sec) => sec.id === activeSectionId);
    return i === -1 ? (sections.length > 0 ? 0 : -1) : i;
  }, [activeSectionId, sections]);
  const activeSection = activeIndex === -1 ? null : sections[activeIndex];

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
        setTrashCount(await countTrash());
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
      setActiveSectionId(s.jsonblob.sections[0]?.id ?? null);

      // Only the reference graphics are loaded up front: they are few, every
      // generation needs them, and they are what the plan modal offers as
      // visual context. Page illustrations are megabytes each and only the
      // open page needs one, so those load on demand — see below.
      const imgMap = {};
      for (const rg of s.jsonblob.referenceGraphics ?? []) {
        if (rg.imageId) {
          const rec = await getImage(rg.imageId);
          if (rec) imgMap[rg.imageId] = rec.data;
        }
      }
      if (!cancelled) setAllImages(imgMap);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeStoryId]);

  /* ---- the open section's illustration, loaded on demand ---- */

  useEffect(() => {
    const sec = sections.find((x) => x.id === activeSectionId);
    const imageId = sec?.type === "illustration" ? sec.imageId : null;
    if (!imageId || allImages[imageId]) return;
    let cancelled = false;
    // Settle first: holding the navigation keys down walks past pages several
    // times a second, and each one of those is a megabyte off the disk.
    const timer = setTimeout(async () => {
      const rec = await getImage(imageId);
      if (cancelled || !rec) return;
      setAllImages((prev) =>
        prev[imageId] ? prev : { ...prev, [imageId]: rec.data }
      );
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeSectionId, sections, allImages]);

  /**
   * Pull in every illustration the story has that isn't in memory yet.
   *
   * The plan modal lets you pick any existing illustration as visual context,
   * so before that modal opens the pictures have to actually be here — which
   * is the one place the on-demand loading above isn't enough.
   */
  const loadAllStoryImages = useCallback(async (storyRec, known) => {
    if (!storyRec) return;
    const missing = collectImageIds(storyRec).filter((id) => !known[id]);
    if (missing.length === 0) return;
    const loaded = {};
    for (const id of missing) {
      const rec = await getImage(id);
      if (rec) loaded[id] = rec.data;
    }
    // Anything that arrived while this ran wins over what was read here.
    setAllImages((prev) => ({ ...loaded, ...prev }));
  }, []);

  /* ---- trash ---- */

  /**
   * Take a picture out of the story and put it in the trash.
   *
   * Every path that drops a picture goes through here, so a generation can
   * only ever leave the story by way of the trash — never straight to gone.
   * Failing to file it is not worth interrupting anyone over: the removal the
   * user asked for has already happened either way.
   */
  const trashPicture = useCallback(async (imageId, origin, storyTitle) => {
    if (!imageId) return;
    try {
      const entry = await trashImage(imageId, { origin, storyTitle });
      if (entry) setTrashCount((n) => n + 1);
    } catch (err) {
      console.error("could not move the picture to the trash", err);
    }
  }, []);

  /** Read the trash out of the database — the window's only source of truth. */
  const loadTrash = useCallback(async () => {
    setTrashLoading(true);
    try {
      const items = await listTrash();
      setTrashItems(items);
      setTrashCount(items.length);
    } catch (err) {
      setError("Could not open the trash: " + err.message);
    } finally {
      setTrashLoading(false);
    }
  }, []);

  /** The navbar bin: everything in the trash, with the ways to clear it. */
  const handleOpenTrash = useCallback(() => {
    setTrashPickSectionId(null);
    setTrashOpen(true);
    loadTrash();
  }, [loadTrash]);

  /** The same window as a picker, opened by a page wanting a picture. */
  const handleTakeFromTrash = useCallback(
    (sectionId) => {
      setTrashPickSectionId(sectionId);
      setTrashOpen(true);
      loadTrash();
    },
    [loadTrash]
  );

  const handleCloseTrash = useCallback(() => {
    setTrashOpen(false);
    setTrashPickSectionId(null);
  }, []);

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
      // Counted off the story itself: with images loading on demand, what is
      // in memory is no longer what deletion would destroy.
      imageCount: story ? collectImageIds(story).length : 0,
    });
  }, [activeStoryId, story, storyList]);

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
      // deleteStory moves the story's pictures into the trash rather than
      // destroying them, so the badge has to grow by however many it took.
      const snapshot = await deleteStoryDb(id);
      setTrashCount((n) => n + (snapshot.images?.length ?? 0));
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

  /**
   * Import one or more story ZIPs.
   *
   * Each file is handled independently so one bad archive cannot abort the
   * rest of a batch — useful when restoring a whole shelf of stories at once.
   * A bundle whose story id is already present is imported as a copy under
   * fresh ids rather than overwriting what is here.
   */
  const handleImport = useCallback(
    async (files) => {
      await flushSave();
      setImporting(true);
      setError(null);
      setImportNote(null);
      try {
        const existingIds = (await listStories()).map((s) => s.id);
        const added = [];
        const failures = [];
        let copies = 0;
        let droppedImages = 0;

        for (const file of files) {
          try {
            const bundle = await readStoryBundle(file);
            const prepared = prepareForImport(bundle, existingIds);
            await saveStoryWithImages(prepared.story, prepared.images);
            existingIds.push(prepared.story.id);
            added.push({ id: prepared.story.id, title: prepared.story.title });
            if (prepared.remapped) copies++;
            droppedImages += prepared.droppedImageRefs;
          } catch (err) {
            failures.push(`${file.name}: ${err.message}`);
          }
        }

        if (added.length > 0) {
          setStoryList((prev) => [...prev, ...added]);
          setActiveStoryId(added[added.length - 1].id);
          const bits = [
            `Imported ${added.length} ${added.length === 1 ? "story" : "stories"}`,
          ];
          if (copies > 0) {
            bits.push(
              `${copies} already existed and came in as ${copies === 1 ? "a copy" : "copies"}`
            );
          }
          if (droppedImages > 0) {
            bits.push(
              `${droppedImages} ${droppedImages === 1 ? "picture was" : "pictures were"} missing from the archive and can be generated again`
            );
          }
          setImportNote(bits.join(" — ") + ".");
        }
        if (failures.length > 0) {
          setError(`Could not import: ${failures.join("; ")}`);
        }
      } catch (err) {
        setError("Import failed: " + err.message);
      } finally {
        setImporting(false);
      }
    },
    [flushSave]
  );

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
      trashPicture(removed.imageId, "reference", story.title);
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
    [referenceGraphics, story, trashPicture, updateStory]
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
      // Whatever is on this reference now is about to be replaced; hold on to
      // its id so the old picture can go to the trash rather than nowhere.
      const replaced = referenceGraphics.find((rg) => rg.id === rgId)?.imageId;
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
        await trashPicture(replaced, "replaced", story.title);
      } catch (err) {
        setError(err.message);
      } finally {
        setGeneratingRefIds((prev) => ({ ...prev, [rgId]: false }));
      }
    },
    [apiKey, referenceGraphics, style, story, trashPicture, updateStory]
  );

  const handleUploadRefGraphic = useCallback(
    async (rgId, dataUrl) => {
      if (!story) return;
      setError(null);
      const replaced = referenceGraphics.find((rg) => rg.id === rgId)?.imageId;
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
        await trashPicture(replaced, "replaced", story.title);
      } catch (err) {
        setError(err.message);
      }
    },
    [referenceGraphics, story, trashPicture, updateStory]
  );

  /* ---- keeping the open section in view ---- */

  /*
   * Turning a page should land on the page, not somewhere above it.
   *
   * Only the open section is mounted, so a page turn doesn't scroll anything by
   * itself: the new page is drawn wherever the old one was, which is off screen
   * as soon as the story cards above it are taller than the window.
   * `revealActiveSection` below is the correction — and since the point of a
   * page is its picture, it aims at the illustration when the whole card is
   * too tall to fit in the window.
   */

  /*
   * Measure the sticky navbar.
   *
   * That band is on screen but not visible, so nothing should be scrolled
   * underneath it — and the sidebar has to start below it. A ref callback
   * rather than an effect because the navbar isn't mounted for the whole life
   * of the app: the age gate stands in front of it, and it wraps to two rows
   * on a narrow window.
   */
  const measureNavbar = useCallback((nav) => {
    if (!nav) return undefined;
    const measure = () => {
      navbarHeightRef.current = nav.offsetHeight;
      document.documentElement.style.setProperty(
        "--navbar-height",
        `${nav.offsetHeight}px`
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
  }, []);

  /** Scroll the open section — or at least its picture — fully into view. */
  const revealActiveSection = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const topInset = navbarHeightRef.current;
    const room = window.innerHeight - topInset;
    const image = editor.querySelector(".image-preview img");
    // The whole card when it fits; otherwise the illustration, which is the
    // part that is worth having all of.
    const fits = editor.getBoundingClientRect().height <= room;
    scrollIntoViewFully(fits || !image ? editor : image, { topInset });
  }, []);

  /**
   * Ask for the open section to be shown after this render.
   *
   * A fresh object every time, so asking twice for the same section — clicking
   * the row you are already on — still counts as asking.
   */
  const requestReveal = useCallback((id) => setRevealRequest({ id }), []);

  // Deliberate page turns only: switching stories or loading one shouldn't
  // yank the view down past the title and style cards.
  useEffect(() => {
    if (!revealRequest) return;
    revealedRef.current = revealRequest.id;
    revealActiveSection();
  }, [revealRequest, revealActiveSection]);

  /**
   * A picture finished decoding.
   *
   * Until then it had no height, so a page turn that aimed at this section
   * aimed at a card that has since grown. Aim again — but only for a section
   * the user actually turned to, so an image arriving on its own doesn't move
   * the page underneath them.
   */
  const handleImageShown = useCallback(
    (sectionId) => {
      if (revealedRef.current !== sectionId) return;
      revealActiveSection();
    },
    [revealActiveSection]
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
      setActiveSectionId(id);
      requestReveal(id);
    },
    [requestReveal, updateStory]
  );

  const addMarkdownSection = useCallback(
    () => addSection("markdown"),
    [addSection]
  );
  const addIllustrationSection = useCallback(
    () => addSection("illustration"),
    [addSection]
  );

  /** Remove a section, keeping a snapshot the toast can put back. */
  const removeSectionNow = useCallback(
    (sectionId) => {
      const index = sections.findIndex((sec) => sec.id === sectionId);
      if (index === -1 || !story) return;
      const removed = sections[index];
      if (removed.type === "illustration") {
        trashPicture(removed.imageId, "page", story.title);
      }
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
      // The page you were looking at just went away: land on its neighbour.
      if (removed.id === activeSectionId) {
        const next = sections[index + 1] ?? sections[index - 1] ?? null;
        setActiveSectionId(next?.id ?? null);
      }
    },
    [activeSectionId, sections, story, trashPicture, updateStory]
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

  /**
   * Put a picture from the user's own computer on a page.
   *
   * Same swap as generating one, minus the API call — a scan, a photo, a
   * picture from somewhere else. Whatever the page held goes to the trash.
   */
  const handleUploadIllustration = useCallback(
    async (sectionId, dataUrl) => {
      const sec = sections.find((x) => x.id === sectionId);
      if (!sec || !story) return;
      setError(null);
      try {
        const imgId = newImageId();
        await saveImage({
          id: imgId,
          storyId: story.id,
          caption: sec.caption ?? "",
          data: dataUrl,
        });
        setAllImages((prev) => ({ ...prev, [imgId]: dataUrl }));
        updateSectionField(sectionId, "imageId", imgId);
        await trashPicture(sec.imageId, "replaced", story.title);
      } catch (err) {
        setError("Could not put that picture on the page: " + err.message);
      }
    },
    [sections, story, trashPicture, updateSectionField]
  );

  /* ---- section navigation ---- */

  const handleSelectSection = useCallback(
    (id) => {
      setActiveSectionId(id);
      requestReveal(id);
    },
    [requestReveal]
  );

  /** Move the selection: "prev" | "next" | "first" | "last". */
  const navigateSections = useCallback(
    (direction) => {
      if (sections.length === 0) return;
      const target =
        direction === "first"
          ? 0
          : direction === "last"
            ? sections.length - 1
            : activeIndex + (direction === "next" ? 1 : -1);
      if (target < 0 || target >= sections.length) return;
      setActiveSectionId(sections[target].id);
      requestReveal(sections[target].id);
    },
    [activeIndex, requestReveal, sections]
  );

  const handlePrevSection = useCallback(
    () => navigateSections("prev"),
    [navigateSections]
  );
  const handleNextSection = useCallback(
    () => navigateSections("next"),
    [navigateSections]
  );

  // Off while a dialog owns the keyboard, so Escape-and-arrow habits inside
  // the plan or confirm dialogs don't move the story underneath them.
  useSectionShortcuts(
    !!story && !illustrationPlan && !confirm && !trashOpen && sections.length > 0,
    navigateSections
  );

  /* ---- acting on what is in the trash ---- */

  /**
   * Put a picture from the trash onto the page that asked for it.
   *
   * It may have come from another story, so the record is re-stamped on the
   * way out: the images store is indexed by story, and a picture still
   * carrying its old story's id would be swept up when that story is deleted.
   */
  const handleUseTrashedPicture = useCallback(
    async (entry) => {
      const sectionId = trashPickSectionId;
      const sec = sections.find((x) => x.id === sectionId);
      if (!sec || !story) return;
      setTrashBusyId(entry.id);
      setError(null);
      try {
        await flushSave();
        const replaced = sec.imageId;
        const picture = await untrashImage(entry.id, {
          storyId: story.id,
          caption: sec.caption || entry.caption || "",
        });
        if (!picture) {
          setError("That picture is no longer in the trash.");
          return;
        }
        setAllImages((prev) => ({ ...prev, [picture.id]: picture.data }));
        updateSectionField(sectionId, "imageId", picture.id);
        // A straight swap: what was on the page takes the picture's place.
        await trashPicture(replaced, "replaced", story.title);
        setTrashOpen(false);
        setTrashPickSectionId(null);
        requestReveal(sectionId);
      } catch (err) {
        setError("Could not take that picture out of the trash: " + err.message);
      } finally {
        setTrashBusyId(null);
        await loadTrash();
      }
    },
    [
      flushSave,
      loadTrash,
      requestReveal,
      sections,
      story,
      trashPicture,
      trashPickSectionId,
      updateSectionField,
    ]
  );

  /** The one place a picture is actually destroyed, one at a time. */
  const destroyTrashedNow = useCallback(
    async (imageId) => {
      setTrashBusyId(imageId);
      try {
        await deleteTrashedImage(imageId);
      } catch (err) {
        setError("Could not empty that out of the trash: " + err.message);
      } finally {
        setTrashBusyId(null);
        await loadTrash();
      }
    },
    [loadTrash]
  );

  /** …and the one place every picture in the trash is destroyed at once. */
  const emptyTrashNow = useCallback(async () => {
    try {
      await emptyTrash();
      // An undo toast still on screen offers to put back a picture that no
      // longer exists; the panel would come back bare. Close the offer.
      setUndo(null);
    } catch (err) {
      setError("Could not empty the trash: " + err.message);
    } finally {
      await loadTrash();
    }
  }, [loadTrash]);

  const handleRequestDestroyTrashed = useCallback(
    (entry) =>
      setConfirm({
        kind: "trashItem",
        id: entry.id,
        label: entry.caption || "This picture",
      }),
    []
  );

  const handleRequestEmptyTrash = useCallback(
    () => setConfirm({ kind: "emptyTrash", count: trashItems.length }),
    [trashItems.length]
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
    else if (pending.kind === "trashItem") destroyTrashedNow(pending.id);
    else if (pending.kind === "emptyTrash") emptyTrashNow();
  }, [
    confirm,
    deleteStoryNow,
    destroyTrashedNow,
    emptyTrashNow,
    removeRefGraphicNow,
    removeSectionNow,
  ]);

  const handleDismissUndo = useCallback(() => setUndo(null), []);

  /** Put back whatever the last deletion took, at the position it held. */
  const handleUndo = useCallback(async () => {
    if (!undo) return;
    const pending = undo;
    setUndo(null);

    if (pending.kind === "story") {
      if (!pending.snapshot?.story) return;
      // restoreStory takes the story's pictures back out of the trash too.
      await restoreStory(pending.snapshot);
      setTrashCount((n) =>
        Math.max(0, n - (pending.snapshot.images?.length ?? 0))
      );
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

    // The picture went to the trash when its panel did, so it comes back with
    // it. Null when the trash was emptied inside the undo window — the panel
    // still returns, just without its artwork.
    const picture = await untrashImage(item.imageId);
    if (picture) {
      setTrashCount((n) => Math.max(0, n - 1));
      setAllImages((prev) => ({ ...prev, [picture.id]: picture.data }));
    }

    updateStory((s) => {
      // Guard against the story having been switched out from under the toast.
      if (s.id !== pending.storyId) return s;
      const list = s.jsonblob[key];
      if (list.some((x) => x.id === item.id)) return s;
      const next = [...list];
      next.splice(Math.min(pending.index, next.length), 0, item);
      return { ...s, jsonblob: { ...s.jsonblob, [key]: next } };
    });

    if (pending.kind === "section") {
      setActiveSectionId(item.id);
      requestReveal(item.id);
    }
  }, [flushSave, requestReveal, undo, updateStory]);

  /* ---- illustration plan → generate ---- */

  /**
   * Ask the model to plan the illustration for a section.
   * Returns the plan, or null if planning failed (error is surfaced).
   */
  const runPlan = useCallback(
    async (sectionId, textModel) => {
      const sec = sections.find((x) => x.id === sectionId);
      if (!sec) return null;
      // A caption typed a moment ago is still sitting in the 500 ms debounce.
      // Planning takes seconds and can fail, so put the edit on disk first —
      // whatever the model does, the user's own words are already saved.
      await flushSave();
      setError(null);
      setPlanningSections((prev) => ({ ...prev, [sectionId]: true }));
      try {
        // The picker in the review modal offers every existing illustration,
        // so fetch the ones that aren't in memory while the model thinks.
        const [plan] = await Promise.all([
          planIllustration(
            apiKey,
            style,
            referenceGraphics,
            sections,
            sec.caption,
            allImages,
            textModel
          ),
          loadAllStoryImages(story, allImages),
        ]);
        return plan;
      } catch (err) {
        setError(err.message);
        return null;
      } finally {
        setPlanningSections((prev) => ({ ...prev, [sectionId]: false }));
      }
    },
    [
      apiKey,
      allImages,
      flushSave,
      loadAllStoryImages,
      story,
      style,
      referenceGraphics,
      sections,
    ]
  );

  /**
   * Generate + persist the image for a section from a finished plan.
   * Returns { ok, error } so a caller holding the plan can decide what to do
   * with it rather than having to watch the error banner.
   */
  const runGenerate = useCallback(
    async (sectionId, plan) => {
      if (!story) return { ok: false, error: null };
      await flushSave();
      setError(null);
      setGeneratingSections((prev) => ({ ...prev, [sectionId]: true }));

      try {
        // Collect reference images from the plan
        const refImgs = [];
        for (const imgId of plan.referenceImageIds) {
          // May name an illustration from a page this session never opened.
          const dataUrl = allImages[imgId] ?? (await getImage(imgId))?.data;
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
        const previous = sections.find((x) => x.id === sectionId);
        await saveImage({
          id: imgId,
          storyId: story.id,
          caption: previous?.caption,
          data: dataUrl,
        });

        setAllImages((prev) => ({ ...prev, [imgId]: dataUrl }));
        // Dropped harmlessly if the page was removed while this was in flight.
        updateSectionField(sectionId, "imageId", imgId);
        // Re-generating a page is the quietest way to lose a picture: no
        // dialog, no toast, the old one simply stops being shown. It goes to
        // the trash like any other removal. (Already trashed, if the page was
        // removed mid-flight — filing it twice is a no-op.)
        await trashPicture(previous?.imageId, "replaced", story.title);
        return { ok: true, error: null };
      } catch (err) {
        setError(err.message);
        return { ok: false, error: err.message };
      } finally {
        setGeneratingSections((prev) => ({ ...prev, [sectionId]: false }));
      }
    },
    [
      apiKey,
      allImages,
      flushSave,
      sections,
      story,
      trashPicture,
      updateSectionField,
    ]
  );

  /** Plan only, then open the review modal. */
  const handlePlanIllustration = useCallback(
    async (sectionId, textModel) => {
      if (!story) return;
      const plan = await runPlan(sectionId, textModel);
      if (plan) {
        setIllustrationPlan({ sectionId, ...plan, notice: planNotice(plan) });
      }
    },
    [runPlan, story]
  );

  /**
   * One-shot: plan and immediately generate, skipping the review modal.
   *
   * A plan that had to be salvaged from a damaged reply stops at the modal
   * instead — better to have the user look at a half-recovered prompt than to
   * spend a generation on it and replace the panel's artwork with the result.
   */
  const handleGenerateIllustration = useCallback(
    async (sectionId, textModel, imageModel) => {
      if (!story) return;
      const plan = await runPlan(sectionId, textModel);
      if (!plan) return;
      if (plan.partial) {
        setIllustrationPlan({
          sectionId,
          ...plan,
          imageModel,
          notice: planNotice(plan),
        });
        return;
      }
      await runGenerate(sectionId, { ...plan, imageModel });
    },
    [runGenerate, runPlan, story]
  );

  /**
   * The modal closes as generation starts, but a failed generation would
   * otherwise take the reviewed prompt with it — so put it back on failure.
   */
  const handleApproveIllustration = useCallback(
    async (approvedPlan) => {
      const { sectionId } = illustrationPlan;
      setIllustrationPlan(null);
      const { ok, error: failure } = await runGenerate(sectionId, approvedPlan);
      if (!ok) {
        setIllustrationPlan({
          sectionId,
          ...approvedPlan,
          notice:
            (failure ? `That generation failed — ${failure} ` : "") +
            "Your prompt and reference picks are still here, so you can " +
            "adjust them and try again.",
        });
      }
    },
    [illustrationPlan, runGenerate]
  );

  const handleCancelPlan = useCallback(() => setIllustrationPlan(null), []);

  /**
   * Which page an open plan belongs to.
   *
   * Planning takes seconds, and with one section on screen at a time the
   * modal can easily open over a different page than the one it is for.
   */
  /** The page the trash picker was opened from, named the way its card is. */
  const trashPickLabel = useMemo(() => {
    if (!trashPickSectionId) return null;
    const idx = sections.findIndex((sec) => sec.id === trashPickSectionId);
    return idx === -1 ? null : sectionTitle(sections[idx], idx);
  }, [sections, trashPickSectionId]);

  const planSectionLabel = useMemo(() => {
    if (!illustrationPlan) return null;
    const idx = sections.findIndex(
      (sec) => sec.id === illustrationPlan.sectionId
    );
    return idx === -1 ? null : sectionTitle(sections[idx], idx);
  }, [illustrationPlan, sections]);

  /* ---- render ---- */

  if (!ready) return null; // waiting for DB

  if (!ageAgreed) {
    return <AgeGate onAccept={() => setAgeAgreed(true)} />;
  }

  return (
    <div className="app-shell">
      <Navbar
        ref={measureNavbar}
        stories={storyList}
        activeStoryId={activeStoryId}
        onSelectStory={handleSelectStory}
        onNewStory={handleNewStory}
        onDeleteStory={handleRequestDeleteStory}
        onLoadExample={handleLoadExample}
        loadingExample={loadingExample}
        onImport={handleImport}
        importing={importing}
        onOpenTrash={handleOpenTrash}
        trashCount={trashCount}
      />

      <div className="app">
        {/* The story index: a left-hand sidebar on a wide screen, and the
            first thing under the navbar on a narrow one. It leads <main> in
            the markup either way, so Tab reaches it in one stop. */}
        {story && (
          <aside className="story-nav" aria-label="Story sections">
            <SectionIndex
              sections={sections}
              activeId={activeSection?.id ?? null}
              generatingSections={generatingSections}
              planningSections={planningSections}
              onSelect={handleSelectSection}
              onAddMarkdown={addMarkdownSection}
              onAddIllustration={addIllustrationSection}
            />
          </aside>
        )}

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

              {/* The one open section, the one the index points at */}
              {activeSection && (
                <div className="section-editor" ref={editorRef}>
                  <div className="section-pager">
                    <button
                      type="button"
                      className="btn-small"
                      onClick={handlePrevSection}
                      disabled={activeIndex <= 0}
                      title="Previous section (Alt+↑, hold to go faster)"
                      aria-keyshortcuts="Alt+ArrowUp"
                    >
                      ← Previous
                    </button>
                    <span className="section-pager-label">
                      {activeIndex + 1} of {sections.length}
                    </span>
                    <button
                      type="button"
                      className="btn-small"
                      onClick={handleNextSection}
                      disabled={activeIndex >= sections.length - 1}
                      title="Next section (Alt+↓, hold to go faster)"
                      aria-keyshortcuts="Alt+ArrowDown"
                    >
                      Next →
                    </button>
                  </div>

                  {activeSection.type === "markdown" ? (
                    <MarkdownSection
                      key={activeSection.id}
                      index={activeIndex}
                      content={activeSection.content}
                      onContentChange={(val) =>
                        updateSectionField(activeSection.id, "content", val)
                      }
                      onRemove={() => handleRemoveSection(activeSection.id)}
                      onMoveUp={
                        activeIndex > 0
                          ? () => moveSection(activeSection.id, -1)
                          : null
                      }
                      onMoveDown={
                        activeIndex < sections.length - 1
                          ? () => moveSection(activeSection.id, 1)
                          : null
                      }
                    />
                  ) : (
                    <Illustration
                      key={activeSection.id}
                      index={activeIndex}
                      caption={activeSection.caption}
                      imageUrl={
                        activeSection.imageId
                          ? allImages[activeSection.imageId] ?? null
                          : null
                      }
                      generating={!!generatingSections[activeSection.id]}
                      planning={!!planningSections[activeSection.id]}
                      onCaptionChange={(val) =>
                        updateSectionField(activeSection.id, "caption", val)
                      }
                      onGenerateIllustration={(textModel, imageModel) =>
                        handleGenerateIllustration(
                          activeSection.id,
                          textModel,
                          imageModel
                        )
                      }
                      onPlanIllustration={(textModel) =>
                        handlePlanIllustration(activeSection.id, textModel)
                      }
                      onUploadIllustration={(dataUrl) =>
                        handleUploadIllustration(activeSection.id, dataUrl)
                      }
                      onTakeFromTrash={() =>
                        handleTakeFromTrash(activeSection.id)
                      }
                      trashCount={trashCount}
                      onImageShown={() => handleImageShown(activeSection.id)}
                      onRemove={() => handleRemoveSection(activeSection.id)}
                      onMoveUp={
                        activeIndex > 0
                          ? () => moveSection(activeSection.id, -1)
                          : null
                      }
                      onMoveDown={
                        activeIndex < sections.length - 1
                          ? () => moveSection(activeSection.id, 1)
                          : null
                      }
                    />
                  )}
                </div>
              )}

              {/* Export */}
              <ExportButtons story={story} />
            </>
          )}

          {importNote && (
            <div className="import-banner" role="status">
              {importNote}
              <button
                type="button"
                className="btn-small"
                onClick={() => setImportNote(null)}
              >
                Dismiss
              </button>
            </div>
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
          sectionLabel={planSectionLabel}
          notice={illustrationPlan.notice}
          allImages={allImages}
          referenceGraphics={referenceGraphics}
          sections={sections}
          onApprove={handleApproveIllustration}
          onCancel={handleCancelPlan}
        />
      )}

      {/* Pictures taken out of a story, waiting to be put back or emptied */}
      {trashOpen && (
        <TrashBin
          items={trashItems}
          loading={trashLoading}
          busyId={trashBusyId}
          dialogOpen={!!confirm}
          pickLabel={trashPickLabel}
          onUse={handleUseTrashedPicture}
          onDeleteForever={handleRequestDestroyTrashed}
          onEmpty={handleRequestEmptyTrash}
          onClose={handleCloseTrash}
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
