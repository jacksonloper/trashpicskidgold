/**
 * IndexedDB persistence layer.
 *
 * Stores:
 *   settings  – key/value pairs (e.g. API key)
 *   stories   – { id, title, jsonblob }
 *   images    – { id, storyId, caption, data, characterReferenceId }
 */

const DB_NAME = "storymaker";
const DB_VERSION = 1;

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

export async function deleteStory(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["images", "stories"], "readwrite");
    const imgStore = tx.objectStore("images");
    const idx = imgStore.index("storyId");
    const keysReq = idx.getAllKeys(id);
    keysReq.onsuccess = () => {
      for (const k of keysReq.result) imgStore.delete(k);
      tx.objectStore("stories").delete(id);
    };
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
