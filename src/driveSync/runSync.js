/**
 * One sync: look at both sides, plan, and carry the plan out.
 *
 * The Drive side of a story is the same ZIP that Export produces — one file
 * per story in a "Story Maker" folder — so anything that goes wrong here can
 * be recovered with Import, and a grown-up browsing Drive sees ordinary
 * downloadable backups rather than an opaque blob.
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
  buildStoryBundle,
  readStoryBundle,
  prepareForImport,
  collectImageIds,
  slugify,
} from "../storyBundle";
import {
  ensureFolder,
  listFiles,
  isFileLive,
  uploadFile,
  downloadFile,
  trashFile,
} from "./driveClient";
import { planSync, APP_PROPERTY } from "./planSync";

export const DRIVE_SETTING = "drive";
export const FOLDER_NAME = "Story Maker";

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

async function bundleBlob(story) {
  const imageMap = {};
  for (const id of collectImageIds(story)) {
    const rec = await getImage(id);
    if (rec) imageMap[id] = rec;
  }
  const { zip } = buildStoryBundle(story, imageMap);
  return zip.generateAsync({ type: "blob" });
}

async function fetchBundle(file) {
  const blob = await downloadFile(file.id);
  return readStoryBundle(new File([blob], file.name || "story.zip"));
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
  const folderId = await ensureFolder(FOLDER_NAME, config.folderId);
  if (config.folderId && config.folderId !== folderId) {
    // The folder we knew is gone (trashed, or a different account): what we
    // remembered about its files means nothing now. Start over, and every
    // local story goes up fresh.
    await clearSyncRecords();
  }
  if (folderId !== config.folderId) await saveDriveConfig({ folderId });

  const [remoteFiles, localStories, syncRecords] = await Promise.all([
    listFiles(folderId),
    listStoriesFull(),
    listSyncRecords(),
  ]);
  const ops = planSync({ localStories, syncRecords, remoteFiles });
  const localById = new Map(localStories.map((s) => [s.id, s]));

  let done = 0;
  for (const op of ops) {
    onProgress?.({ done, total: ops.length, op });
    try {
      await runOp(op, { folderId, localById, isDirty, summary });
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

async function runOp(op, { folderId, localById, isDirty, summary }) {
  switch (op.op) {
    case "upload": {
      const story = await getStory(op.storyId);
      if (!story) return; // deleted between plan and now
      const blob = await bundleBlob(story);
      const uploaded = await uploadFile({
        fileId: op.fileId,
        folderId,
        name: `${slugify(story.title)}.zip`,
        appProperties: { [APP_PROPERTY]: story.id },
        blob,
      });
      await putSyncRecord({
        storyId: story.id,
        fileId: uploaded.id,
        syncedAt: story.updatedAt ?? 0,
        remoteModified: uploaded.modifiedTime,
      });
      summary.uploaded++;
      return;
    }

    case "download": {
      if (isDirty(op.storyId)) return; // next time
      const bundle = await fetchBundle(op.file);
      if (bundle.story.id !== op.storyId) {
        throw new Error("the file on Drive belongs to a different story");
      }
      // Ids preserved: the planner's ids list is empty on purpose, so this
      // is a replacement rather than a copy.
      const prepared = prepareForImport(bundle, []);
      const was = localById.get(op.storyId);
      const keep = new Set(collectImageIds(prepared.story));
      const retiredImageIds = was
        ? collectImageIds(was).filter((id) => !keep.has(id))
        : [];
      const already = new Set(await getStoryImageIds(op.storyId));
      await applyRemoteStory({
        story: { ...prepared.story, updatedAt: op.file.modifiedTime },
        images: prepared.images.filter((img) => !already.has(img.id)),
        syncRecord: {
          storyId: op.storyId,
          fileId: op.fileId,
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
      const bundle = await fetchBundle(op.file);
      const prepared = prepareForImport(bundle, [op.storyId]);
      prepared.story.title = `${prepared.story.title} (Drive copy)`;
      await saveStoryWithImages(prepared.story, prepared.images);
      summary.copies++;
      summary.changedStoryIds.push(prepared.story.id);
      return;
    }

    case "trashRemote": {
      await trashFile(op.fileId);
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
