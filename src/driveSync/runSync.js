/**
 * One sync: look at both sides, plan, and carry the plan out.
 *
 * On Drive a story is a folder, laid out exactly like the ZIP that Export
 * produces, unpacked:
 *
 *   Story Maker/
 *     <title>/
 *       story.json      { formatVersion, id, title, jsonblob }   ← the stamp
 *       images.json     [ { id, storyId, caption, characterReferenceId, file } ]
 *       images/
 *         <caption>_<id>.png …
 *       history/
 *         2026-10-22T01-02-03Z.json …   every version of the words, ever
 *
 * A picture never changes once it has an id, so each one is uploaded once
 * and never touched again: adding an illustration to a seventy-page story
 * sends up one picture and two small JSON files. story.json is the head:
 * its modifiedTime is what the planner compares, and every upload first
 * drops the same text into history/ under the time it was saved, so no
 * version of the words is ever lost to a later edit. Sync only ever reads
 * the head; history is for people. The whole folder, downloaded from Drive
 * as a ZIP, is something Import can read.
 *
 * Every op is independent and failures are collected, not thrown: one
 * story whose upload fails must not stop the other nine from syncing.
 */

import {
  getSetting,
  putSetting,
  getStory,
  getImage,
  getStoryImageIds,
  listStoriesFull,
  listSyncRecords,
  putSyncRecord,
  deleteSyncRecord,
  clearSyncRecords,
  applyRemoteStory,
  saveStoryWithImages,
  deleteStory,
} from "../db";
import {
  BUNDLE_FORMAT_VERSION,
  prepareForImport,
  collectImageIds,
  dataUrlToBytes,
  bytesToDataUrl,
  extensionForMime,
  mimeForExtension,
  sanitizeFilename,
  slugify,
} from "../storyBundle";
import {
  createFolder,
  ensureFolder,
  listFiles,
  listTagged,
  isFileLive,
  uploadFile,
  renameFile,
  downloadFile,
  trashFile,
} from "./driveClient";
import { planSync, APP_PROPERTY } from "./planSync";

export const DRIVE_SETTING = "drive";
export const FOLDER_NAME = "Story Maker";

/** appProperties tags, so files can be found by what they are, not where. */
const KIND = "storymakerKind";
const IMAGE_ID = "storymakerImageId";
const FOLDER_MIME = "application/vnd.google-apps.folder";

/** What is remembered about Drive between sessions, in the settings store. */
export async function loadDriveConfig() {
  const cfg = await getSetting(DRIVE_SETTING);
  return { enabled: false, folderId: null, lastSyncAt: null, ...(cfg ?? {}) };
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
 * Run a sync. `isDirty(storyId)` lets the caller hold back a download of
 * the story being edited this very second, so a keystroke made while the
 * sync was in flight is never written over.
 *
 * Returns { uploaded, downloaded, copies, trashedRemote, deletedLocal,
 *           changedStoryIds, deletedStoryIds, failures }.
 */
export async function runSync({ isDirty = () => false, onProgress } = {}) {
  const summary = {
    uploaded: 0,
    downloaded: 0,
    copies: 0,
    trashedRemote: 0,
    deletedLocal: 0,
    changedStoryIds: [],
    deletedStoryIds: [],
    failures: [],
  };

  const config = await loadDriveConfig();
  const rootId = await ensureFolder(FOLDER_NAME, config.folderId);
  if (config.folderId && config.folderId !== rootId) {
    // The folder we knew is gone (trashed, or a different account): what we
    // remembered about its files means nothing now. Start over, and every
    // local story goes up fresh.
    await clearSyncRecords();
  }
  if (rootId !== config.folderId) await saveDriveConfig({ folderId: rootId });

  // One request lists every story.json the app has ever made, wherever the
  // grown-up may have dragged its folder to.
  const [remoteFiles, localStories, syncRecords] = await Promise.all([
    listTagged(KIND, "story"),
    listStoriesFull(),
    listSyncRecords(),
  ]);
  const ops = planSync({ localStories, syncRecords, remoteFiles });
  const localById = new Map(localStories.map((s) => [s.id, s]));
  const recordById = new Map(syncRecords.map((r) => [r.storyId, r]));

  let done = 0;
  for (const op of ops) {
    onProgress?.({ done, total: ops.length, op });
    try {
      await runOp(op, {
        rootId,
        localById,
        record: recordById.get(op.storyId),
        isDirty,
        summary,
      });
    } catch (e) {
      const title = localById.get(op.storyId)?.title || op.file?.name || op.storyId;
      summary.failures.push(`${title}: ${e.message}`);
      // Drive signed us out: nothing else will work either.
      if (e.code === "signin" || e.code === "popup") throw e;
    }
    done++;
  }

  await saveDriveConfig({ lastSyncAt: Date.now() });
  return summary;
}

/* ---- the story folder on Drive ---- */

/**
 * Find the parts of a story's folder: the folder itself, its images
 * folder, images.json, and every picture by image id. Any part can be
 * missing; the caller makes what it needs.
 */
async function readStoryFolder(folderId) {
  const children = await listFiles(folderId);
  const imagesFolder = children.find(
    (f) => f.mimeType === FOLDER_MIME && f.name === "images"
  );
  const historyFolder = children.find(
    (f) => f.mimeType === FOLDER_MIME && f.name === "history"
  );
  const index = children.find((f) => f.appProperties[KIND] === "index");
  const images = new Map();
  if (imagesFolder) {
    for (const f of await listFiles(imagesFolder.id)) {
      const id = f.appProperties[IMAGE_ID];
      if (id && !images.has(id)) images.set(id, f);
    }
  }
  return {
    folderId,
    imagesFolderId: imagesFolder?.id ?? null,
    historyFolderId: historyFolder?.id ?? null,
    indexFileId: index?.id ?? null,
    images,
  };
}

/**
 * Pull a story down: story.json, images.json, and the bytes of every
 * picture whose id is not in `haveImageIds`. Returns a bundle in the same
 * shape `readStoryBundle` gives, plus the folder's bookkeeping.
 */
async function fetchRemoteStory(file, haveImageIds) {
  const folderId = file.parents[0];
  const folder = folderId ? await readStoryFolder(folderId) : null;

  const parsed = JSON.parse(await (await downloadFile(file.id)).text());
  if (!parsed?.jsonblob || typeof parsed.jsonblob !== "object") {
    throw new Error("story.json on Drive has no story in it");
  }
  const story = { id: parsed.id, title: parsed.title, jsonblob: parsed.jsonblob };

  let index = [];
  if (folder?.indexFileId) {
    try {
      index = JSON.parse(await (await downloadFile(folder.indexFileId)).text());
    } catch {
      index = []; // captions can come from the story itself
    }
  }
  const indexById = new Map(index.map((e) => [e.id, e]));

  const images = [];
  for (const id of collectImageIds(story)) {
    const meta = indexById.get(id);
    if (haveImageIds.has(id)) {
      // Already here. A placeholder keeps prepareForImport from treating
      // the reference as a picture the bundle lost; it is filtered out
      // before anything is written.
      images.push({ id, storyId: story.id, placeholder: true });
      continue;
    }
    const f = folder?.images.get(id);
    if (!f) continue; // the panel keeps its caption and can be regenerated
    const blob = await downloadFile(f.id);
    const mime = f.mimeType?.startsWith("image/")
      ? f.mimeType
      : mimeForExtension(f.name.split(".").pop());
    images.push({
      id,
      storyId: story.id,
      caption: meta?.caption ?? "",
      data: bytesToDataUrl(new Uint8Array(await blob.arrayBuffer()), mime),
      characterReferenceId: meta?.characterReferenceId ?? null,
    });
  }

  return { story, images, folder };
}

/* ---- ops ---- */

async function runOp(op, { rootId, localById, record, isDirty, summary }) {
  switch (op.op) {
    case "upload": {
      const story = await getStory(op.storyId);
      if (!story) return; // deleted between plan and now
      const name = folderNameFor(story);

      // The folder, made once. A record that names a folder Drive no
      // longer has (an older sync, a folder trashed by hand) falls through
      // to a fresh one, and the story.json inside goes with it.
      let folderId = record?.folderId ?? null;
      let fileId = op.fileId;
      if (folderId && !(await isFileLive(folderId))) {
        folderId = null;
        fileId = null;
      }
      if (!folderId) {
        folderId = await createFolder(name, {
          parentId: rootId,
          appProperties: { [KIND]: "storyFolder", [APP_PROPERTY]: story.id },
        });
      } else if (record?.folderName && record.folderName !== name) {
        await renameFile(folderId, name);
      }

      const folder = await readStoryFolder(folderId);
      let imagesFolderId = folder.imagesFolderId;
      if (!imagesFolderId) {
        imagesFolderId = await createFolder("images", { parentId: folderId });
      }

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
            appProperties: {
              [KIND]: "image",
              [IMAGE_ID]: id,
              [APP_PROPERTY]: story.id,
            },
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
        appProperties: { [KIND]: "index", [APP_PROPERTY]: story.id },
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
      let historyFolderId = folder.historyFolderId;
      if (!historyFolderId) {
        historyFolderId = await createFolder("history", { parentId: folderId });
      }
      await uploadFile({
        folderId: historyFolderId,
        name: `${historyStamp(story.updatedAt)}.json`,
        appProperties: { [KIND]: "history", [APP_PROPERTY]: story.id },
        blob: jsonBlob({ ...text, savedAt: story.updatedAt ?? null }),
      });

      // story.json — the head — goes last: its modifiedTime is the stamp
      // the planner reads, so nothing may be newer than it inside a
      // finished upload.
      const storyFile = await uploadFile({
        fileId,
        folderId,
        name: "story.json",
        appProperties: { [KIND]: "story", [APP_PROPERTY]: story.id },
        blob: jsonBlob(text),
      });

      await putSyncRecord({
        storyId: story.id,
        fileId: storyFile.id,
        folderId,
        folderName: name,
        imagesFolderId,
        historyFolderId,
        indexFileId: indexFile.id,
        syncedAt: story.updatedAt ?? 0,
        remoteModified: storyFile.modifiedTime,
      });
      summary.uploaded++;
      return;
    }

    case "download": {
      if (isDirty(op.storyId)) return; // next time
      const have = new Set(await getStoryImageIds(op.storyId));
      const { story, images, folder } = await fetchRemoteStory(op.file, have);
      if (story.id !== op.storyId) {
        throw new Error("the file on Drive belongs to a different story");
      }
      // Ids preserved: the existing-ids list is empty on purpose, so this
      // is a replacement rather than a copy.
      const prepared = prepareForImport({ story, images }, []);
      const was = localById.get(op.storyId);
      const keep = new Set(collectImageIds(prepared.story));
      const retiredImageIds = was
        ? collectImageIds(was).filter((id) => !keep.has(id))
        : [];
      await applyRemoteStory({
        story: { ...prepared.story, updatedAt: op.file.modifiedTime },
        images: prepared.images.filter((img) => !img.placeholder),
        syncRecord: {
          storyId: op.storyId,
          fileId: op.file.id,
          folderId: folder?.folderId ?? null,
          folderName: folderNameFor(story),
          imagesFolderId: folder?.imagesFolderId ?? null,
          historyFolderId: folder?.historyFolderId ?? null,
          indexFileId: folder?.indexFileId ?? null,
          syncedAt: op.file.modifiedTime,
          remoteModified: op.file.modifiedTime,
        },
        retiredImageIds,
      });
      summary.downloaded++;
      summary.changedStoryIds.push(op.storyId);
      return;
    }

    case "downloadCopy": {
      // A copy gets fresh ids for everything, so every picture must come
      // with its bytes: the ones already here are read back out of the
      // database rather than fetched again.
      const have = new Set(await getStoryImageIds(op.storyId));
      const { story, images } = await fetchRemoteStory(op.file, have);
      const full = [];
      for (const img of images) {
        if (!img.placeholder) {
          full.push(img);
          continue;
        }
        const local = await getImage(img.id);
        if (local) full.push(local);
      }
      const prepared = prepareForImport({ story, images: full }, [op.storyId]);
      prepared.story.title = `${prepared.story.title} (Drive copy)`;
      await saveStoryWithImages(prepared.story, prepared.images);
      summary.copies++;
      summary.changedStoryIds.push(prepared.story.id);
      return;
    }

    case "trashRemote": {
      // The whole folder goes, pictures and all — but only the folder this
      // app made. If the grown-up moved story.json somewhere of their own,
      // just that file goes, and their folder is left alone.
      const inOurFolder =
        record?.folderId && op.file?.parents?.includes(record.folderId);
      await trashFile(inOurFolder ? record.folderId : op.fileId);
      await deleteSyncRecord(op.storyId);
      summary.trashedRemote++;
      return;
    }

    case "deleteLocal": {
      // A listing can miss a file; ask about this one by name before acting
      // on its absence. Its pictures go to the local trash either way.
      if (await isFileLive(op.fileId)) return;
      if (isDirty(op.storyId)) return;
      await deleteStory(op.storyId);
      await deleteSyncRecord(op.storyId);
      summary.deletedLocal++;
      summary.deletedStoryIds.push(op.storyId);
      return;
    }

    case "forget": {
      await deleteSyncRecord(op.storyId);
      return;
    }
  }
}
