/**
 * IndexedDB persistence layer.
 *
 * Stores:
 *   settings  – key/value pairs (e.g. API key)
 *   stories   – { id, title, jsonblob }
 *   images    – { id, storyId, caption, data, characterReferenceId }
 *   trash     – pictures removed from a story, kept until the user empties it
 *
 * Pictures cost an API call and minutes of a child's attention, so nothing
 * ever deletes one outright: every path that takes a picture out of a story
 * moves the record into `trash` instead, and only "Empty trash" — an explicit
 * act by the user — actually destroys it.
 */

const DB_NAME = "storymaker";
const DB_VERSION = 2;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("stories")) {
        db.createObjectStore("stories", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("images")) {
        const imgStore = db.createObjectStore("images", { keyPath: "id" });
        imgStore.createIndex("storyId", "storyId", { unique: false });
      }
      if (!db.objectStoreNames.contains("trash")) {
        db.createObjectStore("trash", { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });

  return dbPromise;
}

/* ---- generic helpers ---- */

async function get(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function put(storeName, record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const req = tx.objectStore(storeName).put(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function del(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const req = tx.objectStore(storeName).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function count(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* ---- settings (API key) ---- */

export async function getApiKey() {
  const rec = await get("settings", "apiKey");
  return rec?.value ?? "";
}

export async function saveApiKey(value) {
  await put("settings", { key: "apiKey", value });
}

/* ---- stories ---- */

export function newStoryId() {
  return crypto.randomUUID();
}

export function newImageId() {
  return crypto.randomUUID();
}

/**
 * Sections are addressed by id rather than by array position so that a
 * removal or reorder can never misroute an in-flight illustration onto a
 * different panel.
 */
export function newSectionId() {
  return crypto.randomUUID();
}

export const DEFAULT_STYLE =
  "Children's book illustration in a warm, whimsical watercolor style with soft edges and bright cheerful colors. Simple, rounded shapes suitable for ages 4-7.";

/**
 * Create a blank story object (not yet persisted).
 */
export function createBlankStory(id) {
  return {
    id,
    title: "Untitled Story",
    jsonblob: {
      style: DEFAULT_STYLE,
      referenceGraphics: [],
      sections: [],
    },
  };
}

/**
 * Migrate a legacy story to the current format.
 *
 * Handles:
 *  - characterSheetImageId → referenceGraphics array  (v1 → v2)
 *  - characters array → dropped; style field added    (v2 → v3)
 *  - sections given stable ids                        (v3 → v4)
 *
 * Returns a new object if migration was needed, or the original if already current.
 */
export function migrateStory(story) {
  let blob = story.jsonblob;
  let changed = false;

  // v1 → v2: characterSheetImageId → referenceGraphics
  if (!blob.referenceGraphics) {
    const referenceGraphics = [];
    if (blob.characterSheetImageId) {
      referenceGraphics.push({
        id: crypto.randomUUID(),
        label: "Character Sheet",
        kind: "character",
        imageId: blob.characterSheetImageId,
      });
    }
    const { characterSheetImageId: _removed, ...rest } = blob;
    blob = { ...rest, referenceGraphics };
    changed = true;
  }

  // v2 → v3: drop characters, ensure style exists, ensure kind on ref graphics
  if (!blob.style) {
    const { characters: _chars, ...rest } = blob;
    blob = { ...rest, style: DEFAULT_STYLE };
    changed = true;
  }

  // Ensure every referenceGraphic has a kind and a prompt field
  const needsKindOrPrompt = (blob.referenceGraphics ?? []).some(
    (rg) => !rg.kind || rg.prompt === undefined
  );
  if (needsKindOrPrompt) {
    blob = {
      ...blob,
      referenceGraphics: blob.referenceGraphics.map((rg) => ({
        ...rg,
        kind: rg.kind || "other",
        prompt: rg.prompt ?? "",
      })),
    };
    changed = true;
  }

  // v3 → v4: every section carries a stable id
  if ((blob.sections ?? []).some((sec) => !sec.id)) {
    blob = {
      ...blob,
      sections: blob.sections.map((sec) =>
        sec.id ? sec : { ...sec, id: newSectionId() }
      ),
    };
    changed = true;
  }

  return changed ? { ...story, jsonblob: blob } : story;
}

export async function listStories() {
  const all = await getAll("stories");
  return all.map((s) => ({ id: s.id, title: s.title }));
}

export async function getStory(id) {
  return get("stories", id);
}

export async function saveStory(story) {
  await put("stories", story);
}

/**
 * Delete a story, moving every picture it owns into the trash.
 *
 * The story record itself is gone once the undo window lapses — it is text,
 * and cheap to write again — but its pictures are not: they sit in the trash
 * until the user empties it.
 *
 * Returns a snapshot of everything that was removed —
 * `{ story, images }` — which can be handed back to `restoreStory`
 * to undo the deletion.
 */
export async function deleteStory(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["images", "stories", "trash"], "readwrite");
    const imgStore = tx.objectStore("images");
    const storyStore = tx.objectStore("stories");
    const trashStore = tx.objectStore("trash");
    const snapshot = { story: null, images: [] };

    // Read the records out before removing them so the caller can undo, and
    // so each trashed picture can carry the title of the story it came from.
    const storyReq = storyStore.get(id);
    storyReq.onsuccess = () => {
      snapshot.story = storyReq.result ?? null;
      storyStore.delete(id);

      // Nested so the story title is already known when the pictures arrive.
      const imgsReq = imgStore.index("storyId").getAll(id);
      imgsReq.onsuccess = () => {
        snapshot.images = imgsReq.result ?? [];
        for (const img of snapshot.images) {
          trashStore.put(
            toTrashRecord(img, {
              origin: "story",
              storyTitle: snapshot.story?.title ?? "",
            })
          );
          imgStore.delete(img.id);
        }
      };
    };

    tx.oncomplete = () => resolve(snapshot);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Write a story and its images in one transaction, so a story is never
 * left visible in the list with only some of its artwork attached.
 */
export async function saveStoryWithImages(story, images) {
  if (!story) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["images", "stories"], "readwrite");
    const imgStore = tx.objectStore("images");
    for (const img of images ?? []) imgStore.put(img);
    tx.objectStore("stories").put(story);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Put back a story (and its images) captured by `deleteStory`.
 *
 * The pictures are live again, so they also come back out of the trash —
 * otherwise undoing a deletion would leave a second copy of every picture
 * sitting there waiting to be emptied.
 *
 * No-op when the snapshot has no story record.
 */
export async function restoreStory(snapshot) {
  if (!snapshot?.story) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["images", "stories", "trash"], "readwrite");
    const imgStore = tx.objectStore("images");
    const trashStore = tx.objectStore("trash");
    for (const img of snapshot.images ?? []) {
      imgStore.put(img);
      trashStore.delete(img.id);
    }
    tx.objectStore("stories").put(snapshot.story);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ---- images ---- */

export async function getImage(id) {
  return get("images", id);
}

export async function saveImage(record) {
  await put("images", record);
}

export async function getStoryImages(storyId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("images", "readonly");
    const idx = tx.objectStore("images").index("storyId");
    const req = idx.getAll(storyId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* ---- trash ---- */

/**
 * Why a picture is in the trash. Shown to the user, so keep the wording
 * something a parent reading the list would recognise.
 */
export const TRASH_ORIGINS = {
  story: "its story was deleted",
  page: "its page was removed",
  reference: "its reference graphic was removed",
  replaced: "it was replaced by a new generation",
};

/** Rough size of a data-URL payload, for showing what the trash is holding. */
function estimateBytes(dataUrl) {
  const b64 = (dataUrl ?? "").split(",")[1] ?? "";
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

/**
 * An image record dressed up for the trash: everything needed to put it back,
 * plus enough context to tell one thumbnail from another weeks later.
 */
function toTrashRecord(image, meta) {
  return {
    ...image,
    storyTitle: meta?.storyTitle ?? "",
    origin: meta?.origin ?? "page",
    deletedAt: Date.now(),
    bytes: estimateBytes(image.data),
  };
}

/** Strip the trash-only bookkeeping back off, leaving a plain image record. */
function toImageRecord(entry) {
  const {
    storyTitle: _storyTitle,
    origin: _origin,
    deletedAt: _deletedAt,
    bytes: _bytes,
    ...image
  } = entry;
  return image;
}

/**
 * Move a picture out of the story and into the trash.
 *
 * Returns the trash record, or null when there was nothing to move — an id
 * that names no image (already trashed, or a reference the story kept after
 * an import dropped the file) is not an error worth interrupting anyone for.
 */
export async function trashImage(imageId, meta) {
  if (!imageId) return null;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["images", "trash"], "readwrite");
    const imgStore = tx.objectStore("images");
    let record = null;

    const req = imgStore.get(imageId);
    req.onsuccess = () => {
      const image = req.result;
      if (!image) return;
      record = toTrashRecord(image, meta);
      tx.objectStore("trash").put(record);
      imgStore.delete(imageId);
    };

    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Move a picture back out of the trash and into the live image store.
 *
 * `overrides` is for a picture landing somewhere other than where it came
 * from: taking one onto a page in a different story has to re-stamp its
 * `storyId`, or deleting that other story later would take this picture with
 * it — the images store is indexed by the story that owns the record.
 *
 * Returns the restored image record, or null when the trash no longer holds
 * it — the undo toast and the trash window can both aim at the same picture.
 */
export async function untrashImage(imageId, overrides) {
  if (!imageId) return null;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["images", "trash"], "readwrite");
    const trashStore = tx.objectStore("trash");
    let record = null;

    const req = trashStore.get(imageId);
    req.onsuccess = () => {
      const entry = req.result;
      if (!entry) return;
      record = { ...toImageRecord(entry), ...(overrides ?? {}) };
      tx.objectStore("images").put(record);
      trashStore.delete(imageId);
    };

    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(tx.error);
  });
}

/** Everything in the trash, most recently removed first. */
export async function listTrash() {
  const all = await getAll("trash");
  return all.sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
}

/** How many pictures the trash is holding — cheap enough for a badge. */
export async function countTrash() {
  return count("trash");
}

/** Destroy one trashed picture for good. */
export async function deleteTrashedImage(imageId) {
  return del("trash", imageId);
}

/** Destroy every trashed picture. Returns how many were removed. */
export async function emptyTrash() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("trash", "readwrite");
    const store = tx.objectStore("trash");
    const countReq = store.count();
    let removed = 0;
    countReq.onsuccess = () => {
      removed = countReq.result;
      store.clear();
    };
    tx.oncomplete = () => resolve(removed);
    tx.onerror = () => reject(tx.error);
  });
}
