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

/**
 * Create a blank story object (not yet persisted).
 */
export function createBlankStory(id) {
  return {
    id,
    title: "Untitled Story",
    jsonblob: {
      characters: [{ name: "", description: "" }],
      referenceGraphics: [],
      sections: [],
    },
  };
}

/**
 * Migrate a legacy story that uses characterSheetImageId to the new
 * referenceGraphics format.  Returns a new object if migration was needed,
 * or the original if it was already current.
 */
export function migrateStory(story) {
  const blob = story.jsonblob;
  if (blob.referenceGraphics) return story; // already migrated

  const referenceGraphics = [];
  if (blob.characterSheetImageId) {
    referenceGraphics.push({
      id: crypto.randomUUID(),
      label: "Character Sheet",
      imageId: blob.characterSheetImageId,
    });
  }

  const { characterSheetImageId: _removed, ...restBlob } = blob;
  return {
    ...story,
    jsonblob: { ...restBlob, referenceGraphics },
  };
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
