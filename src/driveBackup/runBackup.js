/**
 * The backup: every story that has changed since its last upload goes up.
 * Nothing ever comes down. Drive is somewhere the stories are kept safe,
 * not somewhere the app reads them from, so no backup can ever write over
 * or remove a story in the browser.
 *
 * On Drive a story is a folder, laid out like the ZIP that Export produces,
 * unpacked:
 *
 *   trashpicskidgold/
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
 *
 * After each upload the folder is checked, still without reading a byte
 * back: Drive reports a SHA-256 for every file it holds, and that is
 * compared with the hash of the bytes that were sent. The result goes in
 * the story's backup record (verifiedAt, mismatches, treeHash) and the tree
 * hash onto the folder as a tag; a story whose files differ is sent again
 * next time.
 */

import {
  getSetting,
  putSetting,
  getInstallId,
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
  findFoldersByTags,
  listFiles,
  isFileLive,
  uploadFile,
  renameFile,
  setAppProperties,
  trashFile,
} from "./driveClient";
import { sha256Hex, treeHash } from "./hashing";

export const DRIVE_SETTING = "drive";
export const FOLDER_NAME = "trashpicskidgold";

/** appProperties tags, so files can be told apart by what they are. */
const KIND = "storymakerKind";
const STORY_ID = "storymakerStoryId";
const INSTALL_ID = "storymakerInstallId";
const IMAGE_ID = "storymakerImageId";
const TREE_HASH = "storymakerTreeHash";
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
 * Which stories need to go up: those never backed up, those saved since
 * their last upload, and those whose last check found a file on Drive that
 * differs from the one here. Pure, and on this machine's clock only.
 */
export function planBackup(stories, records) {
  const byId = new Map(records.map((r) => [r.storyId, r]));
  return stories.filter((s) => {
    const rec = byId.get(s.id);
    return (
      !rec ||
      (s.updatedAt ?? 0) > (rec.syncedAt ?? 0) ||
      (rec.mismatches?.length ?? 0) > 0
    );
  });
}

/**
 * Run a backup. Returns { uploaded, skipped, failures }.
 */
export async function runBackup({ onProgress } = {}) {
  const summary = { uploaded: 0, skipped: 0, failures: [] };

  const config = await loadDriveConfig();
  const installId = await getInstallId();
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
      await uploadStory(listed.id, {
        rootId,
        installId,
        record: recordById.get(listed.id),
      });
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
    storyFile: children.find((f) => f.appProperties[KIND] === "story") ?? null,
    indexFile: children.find((f) => f.appProperties[KIND] === "index") ?? null,
    images,
  };
}

/**
 * What the story's folder on Drive ought to contain, from what is here:
 * the images.json index, the story.json head, and the SHA-256 of each file
 * the backup is answerable for (the two JSON files and every picture the
 * story refers to; history/ is append-only and not checked). Each picture
 * keeps the name Drive already has for it, so a folder with every picture
 * in place hashes the same whether it is about to be uploaded or merely
 * looked at.
 *
 *   { index, text, pictures: [{ id, rec, fileName, hash, bytes, mime }],
 *     expected: Map("story.json" | "images.json" | "images/<name>" → hash) }
 */
async function localTree(story, folder) {
  const pictures = [];
  const index = [];
  for (const id of collectImageIds(story)) {
    const rec = await getImage(id);
    if (!rec?.data) continue;
    const { bytes, mime } = dataUrlToBytes(rec.data);
    const fileName = folder.images.get(id)?.name ?? imageFileName(rec);
    pictures.push({ id, rec, fileName, bytes, mime, hash: await sha256Hex(bytes) });
    index.push({
      id,
      storyId: story.id,
      caption: rec.caption ?? "",
      characterReferenceId: rec.characterReferenceId ?? null,
      file: `images/${fileName}`,
    });
  }
  const text = {
    formatVersion: BUNDLE_FORMAT_VERSION,
    id: story.id,
    title: story.title,
    jsonblob: story.jsonblob,
  };
  const expected = new Map();
  for (const p of pictures) expected.set(`images/${p.fileName}`, p.hash);
  expected.set("images.json", await sha256Hex(jsonBlob(index)));
  expected.set("story.json", await sha256Hex(jsonBlob(text)));
  return { index, text, pictures, expected };
}

/**
 * Drive's checksums for the files `expected` names, from a listing of the
 * story folder. A file Drive has not finished hashing comes back as
 * `pending`; a file that is not there at all counts as different.
 */
function checksumsOnDrive(folder, expected) {
  const got = new Map();
  const pending = [];
  const byName = new Map();
  for (const [id, f] of folder.images) byName.set(`images/${f.name}`, { id, f });
  for (const path of expected.keys()) {
    let f = null;
    if (path === "story.json") f = folder.storyFile;
    else if (path === "images.json") f = folder.indexFile;
    else f = byName.get(path)?.f ?? null;
    if (!f) got.set(path, null);
    else if (!f.sha256Checksum) pending.push(path);
    else got.set(path, f.sha256Checksum);
  }
  return { got, pending };
}

const CHECKSUM_RETRY_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Compare what is here with what Drive says it holds, by hash only.
 * Lists the folder; when Drive has not yet hashed something just uploaded,
 * waits a moment and lists once more. Returns
 *   { mismatches: [path…], verifiedAt: ms | null, treeHash }
 * verifiedAt is null when any checksum was still missing: not wrong, just
 * not yet known, and never shown as red.
 */
async function compareWithDrive(folderId, expected) {
  let folder = await readStoryFolder(folderId);
  let { got, pending } = checksumsOnDrive(folder, expected);
  if (pending.length) {
    await sleep(CHECKSUM_RETRY_MS);
    folder = await readStoryFolder(folderId);
    ({ got, pending } = checksumsOnDrive(folder, expected));
  }
  const mismatches = [];
  for (const [path, hash] of expected) {
    if (pending.includes(path)) continue;
    if (got.get(path) !== hash) mismatches.push(path);
  }
  mismatches.sort();
  return {
    mismatches,
    verifiedAt: pending.length ? null : Date.now(),
    treeHash: await treeHash(expected),
  };
}

/**
 * Check every backed-up story against Drive, by hash only, and bring its
 * record up to date. A story edited since its last upload is not compared
 * (its bytes here are newer than the ones on Drive, by design) and is
 * counted as waiting. Returns
 *   { verified, waiting, unverified, differing: [title…], failures: [msg…] }
 */
export async function verifyAll({ onProgress } = {}) {
  const out = { verified: 0, waiting: 0, unverified: 0, differing: [], failures: [] };
  const records = await listBackupRecords();
  let done = 0;
  for (const record of records) {
    const story = await getStory(record.storyId);
    if (!story) {
      done++;
      continue;
    }
    onProgress?.({ done, total: records.length, title: story.title });
    if ((story.updatedAt ?? 0) > (record.syncedAt ?? 0)) {
      out.waiting++;
      done++;
      continue;
    }
    try {
      const folder = await readStoryFolder(record.folderId);
      const { expected } = await localTree(story, folder);
      const result = await compareWithDrive(record.folderId, expected);
      await putBackupRecord({ ...record, ...result });
      if (result.treeHash !== record.treeHash && !result.mismatches.length) {
        await setAppProperties(record.folderId, { [TREE_HASH]: result.treeHash });
      }
      if (result.mismatches.length) out.differing.push(story.title || "Untitled");
      else if (result.verifiedAt) out.verified++;
      else out.unverified++;
    } catch (e) {
      out.failures.push(`${story.title || "Untitled"}: ${e.message}`);
      if (e.code === "signin" || e.code === "popup") throw e;
    }
    done++;
  }
  return out;
}

/**
 * A folder name nobody else in the parent is using: the same story restored
 * into two browsers gets "the-lost-star" and "the-lost-star-2", so a parent
 * looking in Drive sees two folders rather than one with a mystery inside.
 */
async function freeFolderName(rootId, wanted) {
  const taken = new Set(
    (await listFiles(rootId))
      .filter((f) => f.mimeType === FOLDER_MIME)
      .map((f) => f.name)
  );
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; ; n++) {
    const candidate = `${wanted}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

async function uploadStory(storyId, { rootId, installId, record }) {
  // Read fresh: the listing may be minutes old by the time this story's
  // turn comes, and the record's stamp must match what actually went up.
  const story = await getStory(storyId);
  if (!story) return; // deleted between plan and now
  const name = folderNameFor(story);

  // The folder, made once. A record that names a folder Drive no longer
  // has (trashed by hand) is ignored. With no record — a reconnect — the
  // folder is found again by its tags: this story's id and this browser's,
  // which every story folder carries, so a story never gets a second
  // folder from the same browser, and never shares one with another.
  let folderId = record?.folderId ?? null;
  if (folderId && !(await isFileLive(folderId))) folderId = null;
  let folderName = record?.folderName ?? null;
  if (!folderId) {
    const found = await findFoldersByTags({
      [STORY_ID]: story.id,
      [INSTALL_ID]: installId,
    });
    if (found.length) {
      folderId = found[0].id;
      folderName = found[0].name;
    }
  }
  if (!folderId) {
    folderName = await freeFolderName(rootId, name);
    folderId = await createFolder(folderName, {
      parentId: rootId,
      appProperties: {
        [KIND]: "storyFolder",
        [STORY_ID]: story.id,
        [INSTALL_ID]: installId,
      },
    });
  } else if (folderName && folderName !== name && !folderName.startsWith(`${name}-`)) {
    // The title changed: the folder follows it, unless its name is only a
    // numbered variant of the same title.
    folderName = await freeFolderName(rootId, name);
    await renameFile(folderId, folderName);
  }

  const folder = await readStoryFolder(folderId);
  const imagesFolderId =
    folder.imagesFolderId ?? (await createFolder("images", { parentId: folderId }));
  const historyFolderId =
    folder.historyFolderId ?? (await createFolder("history", { parentId: folderId }));

  const local = await localTree(story, folder);

  // Pictures: the ones Drive does not have yet, and the ones it has wrong.
  // A picture never changes once it has an id, so a different checksum
  // means the file on Drive is not the one sent (replaced by hand, or a
  // bad upload): it goes to the trash and a fresh copy goes up under the
  // same name. A checksum Drive has not computed yet is left alone.
  for (const p of local.pictures) {
    const have = folder.images.get(p.id);
    if (have && (!have.sha256Checksum || have.sha256Checksum === p.hash)) continue;
    if (have) await trashFile(have.id);
    await uploadFile({
      folderId: imagesFolderId,
      name: p.fileName,
      appProperties: { [KIND]: "image", [IMAGE_ID]: p.id, [STORY_ID]: story.id },
      blob: new Blob([p.bytes], { type: p.mime }),
    });
  }

  const indexFile = await uploadFile({
    fileId: folder.indexFile?.id,
    folderId,
    name: "images.json",
    appProperties: { [KIND]: "index", [STORY_ID]: story.id },
    blob: jsonBlob(local.index),
  });

  // A dated copy of the words, never overwritten. The text of a story is
  // small (pictures are by id), so keeping every version costs nothing,
  // and a page a child dictated last month is still there to read.
  await uploadFile({
    folderId: historyFolderId,
    name: `${historyStamp(story.updatedAt)}.json`,
    appProperties: { [KIND]: "history", [STORY_ID]: story.id },
    blob: jsonBlob({ ...local.text, savedAt: story.updatedAt ?? null }),
  });

  // story.json, the head, goes last: a folder with a story.json in it is
  // a complete bundle, so nothing may be missing by the time it lands.
  const storyFile = await uploadFile({
    fileId: folder.storyFile?.id,
    folderId,
    name: "story.json",
    appProperties: { [KIND]: "story", [STORY_ID]: story.id },
    blob: jsonBlob(local.text),
  });

  // Then look at what landed. A difference is not a failure of the upload
  // (it went up; the record says what is wrong) but it keeps the story in
  // the plan, so the next backup sends the differing files again.
  const check = await compareWithDrive(folderId, local.expected);
  await setAppProperties(folderId, { [TREE_HASH]: check.treeHash });

  await putBackupRecord({
    storyId: story.id,
    folderId,
    folderName,
    imagesFolderId,
    historyFolderId,
    fileId: storyFile.id,
    indexFileId: indexFile.id,
    syncedAt: story.updatedAt ?? 0,
    treeHash: check.treeHash,
    verifiedAt: check.verifiedAt,
    mismatches: check.mismatches,
  });
}
