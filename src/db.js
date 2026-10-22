/**
 * IndexedDB persistence layer.
 *
 * Stores:
 *   settings  – key/value pairs (e.g. API key)
 *   stories   – { id, title, jsonblob }
 *   images    – { id, storyId, caption, data, characterReferenceId }
 *   trash     – pictures removed from a story, kept until the user empties it
 *   backup    – per-story bookkeeping for the Google Drive backup (driveBackup/)
 *
 * Pictures cost an API call and minutes of a child's attention, so nothing
 * ever deletes one outright: every path that takes a picture out of a story
 * moves the record into `trash` instead, and only "Empty trash" — an explicit
 * act by the user — actually destroys it.
 */

const DB_NAME = "storymaker";
const DB_VERSION = 3;

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
      if (!db.objectStoreNames.contains("backup")) {
        db.createObjectStore("backup", { keyPath: "storyId" });
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

/**
 * Ask the browser to keep this site's storage as "persistent" rather than
 * "best effort". Best-effort storage can be evicted when the disk runs low;
 * persistent storage is only ever cleared by the user. Chrome decides on its
 * own (it favours sites that are used a lot, bookmarked or installed),
 * Firefox asks the user once, and the answer sticks either way, so asking on
 * every load is harmless. Resolves to whether storage is now persistent.
 */
export async function requestPersistentStorage() {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
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

/* ---- settings (API key, Drive) ---- */

export async function getSetting(key) {
  const rec = await get("settings", key);
  return rec?.value ?? null;
}

export async function putSetting(key, value) {
  await put("settings", { key, value });
}

/**
 * A permanent id for this browser, minted the first time it is asked for.
 *
 * Story ids are preserved by Import, so the same ZIP restored into two
 * browsers gives both the same story id. The Drive backup tags each story
 * folder with this id as well, so those two browsers back up into two
 * folders rather than taking turns overwriting one.
 */
export async function getInstallId() {
  const have = await getSetting("installId");
  if (have) return have;
  const id = crypto.randomUUID();
  await putSetting("installId", id);
  return id;
}

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

/** The story index: id, title, and `updatedAt` so the backup glyph can tell "sent" from "edited since". */
export async function listStories() {
  const all = await getAll("stories");
  return all.map((s) => ({ id: s.id, title: s.title, updatedAt: s.updatedAt ?? 0 }));
}

export async function getStory(id) {
  return get("stories", id);
}

/**
 * Every story carries `updatedAt`, stamped on each save. The Drive backup
 * compares it with the stamp of the last upload to tell "edited since" from
 * "untouched" without diffing the whole record. Both stamps come from this
 * machine's clock, and a save never moves the stamp backwards, so a clock
 * put right can never make an edit look old.
 */
function stamped(story) {
  return { ...story, updatedAt: Math.max(Date.now(), (story.updatedAt ?? 0) + 1) };
}

/** Save, and return the record as stored (with its new `updatedAt`). */
export async function saveStory(story) {
  const next = stamped(story);
  await put("stories", next);
  return next;
}

/** Every story record in full, for the backup. */
export async function listStoriesFull() {
  return getAll("stories");
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
    tx.objectStore("stories").put(stamped(story));
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

/** Just the ids of a story's pictures, without reading megabytes of them. */
export async function getStoryImageIds(storyId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("images", "readonly");
    const idx = tx.objectStore("images").index("storyId");
    const req = idx.getAllKeys(storyId);
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

/* ---- Google Drive backup bookkeeping ---- */

/**
 * One record per story that has been backed up:
 *   { storyId, folderId, folderName, imagesFolderId, historyFolderId,
 *     fileId, indexFileId, syncedAt, treeHash, verifiedAt, mismatches }
 *
 * `syncedAt` is the story's own `updatedAt` as of its last upload; a story
 * whose `updatedAt` has moved past it goes up again. The ids say where on
 * Drive the story's folder and files are, so an upload can patch them in
 * place rather than make a second folder. The last three are the check
 * made after each upload, by Drive's own checksums: `mismatches` lists the
 * files on Drive that differ from the ones here (empty when all agree),
 * `verifiedAt` is when they were last all found to agree (null while Drive
 * has not yet hashed something), and `treeHash` is one hash over them all
 * (see driveBackup/hashing.js).
 */
export async function listBackupRecords() {
  return getAll("backup");
}

export async function putBackupRecord(record) {
  await put("backup", record);
}

/** Forget everything about Drive: the next backup uploads every story afresh. */
export async function clearBackupRecords() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("backup", "readwrite");
    tx.objectStore("backup").clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
