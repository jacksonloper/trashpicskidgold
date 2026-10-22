/**
 * The backup: every story that has changed since its last upload goes up.
 * Nothing ever comes down. Drive is somewhere the stories are kept safe,
 * not somewhere the app reads them from, so no backup can ever write over
 * or remove a story in the browser.
 *
 * On Drive a story is a folder, laid out like the ZIP that Export produces,
 * unpacked:
 *
 *   Story Maker/
 *     <title>/
 *       story.json      { formatVersion, id, title, jsonblob }   ← the head
 *       images.json     [ { id, storyId, caption, characterReferenceId, file } ]
 *       images/
 *         <caption>_<id>.png …
 *       history/
 *         2026-10-22T01-02-03Z.json …   every version of the words, ever
 *
 * That layout is the point: zip the folder and hand it to Import, and it
 * is a well-formed bundle (story.json and images.json are what Import
 * reads; history/ it ignores). A picture never changes once it has an id,
 * so each is uploaded once and never sent again — adding an illustration
 * to a seventy-page story sends one picture and two small JSON files —
 * and every upload first drops the words into history/ under the time
 * they were saved, which a ZIP does not need but a parent might.
 *
 * Every story is independent and failures are collected, not thrown: one
 * story whose upload fails must not stop the other nine from going up.
 */

import {
  getSetting,
  putSetting,
  getStory,
  getImage,
  listStoriesFull,
  listBackupRecords,
  putBackupRecord,
  clearBackupRecords,
} from "../db";
import {
  BUNDLE_FORMAT_VERSION,
  collectImageIds,
  dataUrlToBytes,
  extensionForMime,
  sanitizeFilename,
  slugify,
} from "../storyBundle";
import {
  createFolder,
  ensureFolder,
  listFiles,
  isFileLive,
  uploadFile,
  renameFile,
} from "./driveClient";

export const DRIVE_SETTING = "drive";
export const FOLDER_NAME = "Story Maker";

/** appProperties tags, so files can be told apart by what they are. */
const KIND = "storymakerKind";
const STORY_ID = "storymakerStoryId";
const IMAGE_ID = "storymakerImageId";
const FOLDER_MIME = "application/vnd.google-apps.folder";

/** What is remembered about Drive between sessions, in the settings store. */
export async function loadDriveConfig() {
  const cfg = await getSetting(DRIVE_SETTING);
  return { enabled: false, folderId: null, lastBackupAt: null, ...(cfg ?? {}) };
}

export async function saveDriveConfig(patch) {
  const next = { ...(await loadDriveConfig()), ...patch };
  await putSetting(DRIVE_SETTING, next);
  return next;
}

function jsonBlob(value) {
  return new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json",
  });
}

function folderNameFor(story) {
  return slugify(story.title) || story.id;
}

/** 2026-10-22T01-02-03Z: sorts by time, and Drive allows no colons. */
function historyStamp(ms) {
  return new Date(ms || Date.now())
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/:/g, "-");
}

function imageFileName(rec) {
  const { mime } = dataUrlToBytes(rec.data);
  return `${sanitizeFilename(rec.caption, "picture")}_${rec.id.slice(0, 8)}.${extensionForMime(mime)}`;
}

/**
 * Which stories need to go up: those never backed up, and those saved
 * since their last upload. Pure, and on this machine's clock only.
 */
export function planBackup(stories, records) {
  const byId = new Map(records.map((r) => [r.storyId, r]));
  return stories.filter((s) => {
    const rec = byId.get(s.id);
    return !rec || (s.updatedAt ?? 0) > (rec.syncedAt ?? 0);
  });
}

/**
 * Run a backup. Returns { uploaded, skipped, failures }.
 */
export async function runBackup({ onProgress } = {}) {
  const summary = { uploaded: 0, skipped: 0, failures: [] };

  const config = await loadDriveConfig();
  const rootId = await ensureFolder(FOLDER_NAME, config.folderId);
  if (config.folderId && config.folderId !== rootId) {
    // The folder we knew is gone (trashed, or a different account): the
    // records point at files that are not there. Start over, and every
    // story goes up afresh.
    await clearBackupRecords();
  }
  if (rootId !== config.folderId) await saveDriveConfig({ folderId: rootId });

  const [stories, records] = await Promise.all([
    listStoriesFull(),
    listBackupRecords(),
  ]);
  const recordById = new Map(records.map((r) => [r.storyId, r]));
  const todo = planBackup(stories, records);
  summary.skipped = stories.length - todo.length;

  let done = 0;
  for (const listed of todo) {
    onProgress?.({ done, total: todo.length, title: listed.title });
    try {
      await uploadStory(listed.id, { rootId, record: recordById.get(listed.id) });
      summary.uploaded++;
    } catch (e) {
      summary.failures.push(`${listed.title || "Untitled"}: ${e.message}`);
      // Drive signed us out: nothing else will work either.
      if (e.code === "signin" || e.code === "popup") throw e;
    }
    done++;
  }

  await saveDriveConfig({ lastBackupAt: Date.now() });
  return summary;
}

/**
 * The parts of a story's folder on Drive: images folder, history folder,
 * images.json, and every picture by image id. Any can be missing; the
 * upload makes what it needs.
 */
async function readStoryFolder(folderId) {
  const children = await listFiles(folderId);
  const sub = (name) =>
    children.find((f) => f.mimeType === FOLDER_MIME && f.name === name);
  const imagesFolder = sub("images");
  const images = new Map();
  if (imagesFolder) {
    for (const f of await listFiles(imagesFolder.id)) {
      const id = f.appProperties[IMAGE_ID];
      if (id && !images.has(id)) images.set(id, f);
    }
  }
  return {
    imagesFolderId: imagesFolder?.id ?? null,
    historyFolderId: sub("history")?.id ?? null,
    storyFileId: children.find((f) => f.appProperties[KIND] === "story")?.id ?? null,
    indexFileId: children.find((f) => f.appProperties[KIND] === "index")?.id ?? null,
    images,
  };
}

async function uploadStory(storyId, { rootId, record }) {
  // Read fresh: the listing may be minutes old by the time this story's
  // turn comes, and the record's stamp must match what actually went up.
  const story = await getStory(storyId);
  if (!story) return; // deleted between plan and now
  const name = folderNameFor(story);

  // The folder, made once. A record that names a folder Drive no longer
  // has (trashed by hand) falls through to a fresh one.
  let folderId = record?.folderId ?? null;
  if (folderId && !(await isFileLive(folderId))) folderId = null;
  if (!folderId) {
    folderId = await createFolder(name, {
      parentId: rootId,
      appProperties: { [KIND]: "storyFolder", [STORY_ID]: story.id },
    });
  } else if (record?.folderName && record.folderName !== name) {
    await renameFile(folderId, name);
  }

  const folder = await readStoryFolder(folderId);
  const imagesFolderId =
    folder.imagesFolderId ?? (await createFolder("images", { parentId: folderId }));
  const historyFolderId =
    folder.historyFolderId ?? (await createFolder("history", { parentId: folderId }));

  // Pictures: only the ones Drive does not have yet.
  const index = [];
  for (const id of collectImageIds(story)) {
    const rec = await getImage(id);
    if (!rec?.data) continue;
    let fileName = folder.images.get(id)?.name;
    if (!fileName) {
      fileName = imageFileName(rec);
      const { bytes, mime } = dataUrlToBytes(rec.data);
      await uploadFile({
        folderId: imagesFolderId,
        name: fileName,
        appProperties: { [KIND]: "image", [IMAGE_ID]: id, [STORY_ID]: story.id },
        blob: new Blob([bytes], { type: mime }),
      });
    }
    index.push({
      id,
      storyId: story.id,
      caption: rec.caption ?? "",
      characterReferenceId: rec.characterReferenceId ?? null,
      file: `images/${fileName}`,
    });
  }

  const indexFile = await uploadFile({
    fileId: folder.indexFileId,
    folderId,
    name: "images.json",
    appProperties: { [KIND]: "index", [STORY_ID]: story.id },
    blob: jsonBlob(index),
  });

  const text = {
    formatVersion: BUNDLE_FORMAT_VERSION,
    id: story.id,
    title: story.title,
    jsonblob: story.jsonblob,
  };

  // A dated copy of the words, never overwritten. The text of a story is
  // small (pictures are by id), so keeping every version costs nothing,
  // and a page a child dictated last month is still there to read.
  await uploadFile({
    folderId: historyFolderId,
    name: `${historyStamp(story.updatedAt)}.json`,
    appProperties: { [KIND]: "history", [STORY_ID]: story.id },
    blob: jsonBlob({ ...text, savedAt: story.updatedAt ?? null }),
  });

  // story.json, the head, goes last: a folder with a story.json in it is
  // a complete bundle, so nothing may be missing by the time it lands.
  const storyFile = await uploadFile({
    fileId: folder.storyFileId,
    folderId,
    name: "story.json",
    appProperties: { [KIND]: "story", [STORY_ID]: story.id },
    blob: jsonBlob(text),
  });

  await putBackupRecord({
    storyId: story.id,
    folderId,
    folderName: name,
    imagesFolderId,
    historyFolderId,
    fileId: storyFile.id,
    indexFileId: indexFile.id,
    syncedAt: story.updatedAt ?? 0,
  });
}
