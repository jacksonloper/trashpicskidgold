/**
 * Decide what a sync should do. Pure: no Drive, no IndexedDB, no clock.
 *
 * Each story is compared on both sides against the stamps taken at its last
 * sync (`syncedAt` for the local record's `updatedAt`, `remoteModified` for
 * the Drive file's modifiedTime). "Moved since" on one side only is a plain
 * copy in that direction; moved on both is a conflict, and a conflict never
 * discards anything: the Drive version comes in as a separate copy, and the
 * local one goes up over the file.
 *
 * Inputs:
 *   localStories  [{ id, title, updatedAt }]
 *   syncRecords   [{ storyId, fileId, syncedAt, remoteModified, deleted }]
 *   remoteFiles   [{ id, name, parents, modifiedTime, appProperties }]
 *                 — one per story: its story.json on Drive
 *
 * Output: a list of ops, each { op, storyId, fileId?, ... }:
 *   upload         local → Drive (creates the file when fileId is null)
 *   download       Drive → local, replacing the story of that id
 *   downloadCopy   Drive → local, as a new story under fresh ids (conflict)
 *   trashRemote    put the Drive file in Drive's trash (story deleted here)
 *   deleteLocal    story was trashed on Drive and is untouched here
 *   forget         drop a sync record that no longer refers to anything
 */

export const APP_PROPERTY = "storymakerStoryId";

export function planSync({ localStories, syncRecords, remoteFiles }) {
  const ops = [];
  const local = new Map(localStories.map((s) => [s.id, s]));
  const records = new Map(syncRecords.map((r) => [r.storyId, r]));

  // Pick one Drive file per story id. Two can exist if the same story was
  // uploaded fresh from two devices before either had synced: keep the newer,
  // and leave the other alone rather than guess.
  const remote = new Map();
  for (const f of remoteFiles) {
    const storyId = f.appProperties?.[APP_PROPERTY];
    if (!storyId) continue;
    const prev = remote.get(storyId);
    if (!prev || f.modifiedTime > prev.modifiedTime) remote.set(storyId, f);
  }

  const ids = new Set([...local.keys(), ...records.keys(), ...remote.keys()]);

  for (const storyId of ids) {
    const story = local.get(storyId);
    const rec = records.get(storyId);
    const file = remote.get(storyId);
    // A record that names a file Drive no longer lists is matched by story
    // id above, so a re-created file (new id, same story) still lines up.

    const localChanged = story
      ? !rec || (story.updatedAt ?? 0) > (rec.syncedAt ?? 0)
      : false;
    const remoteChanged = file
      ? !rec || file.modifiedTime > (rec.remoteModified ?? 0)
      : false;

    if (rec?.deleted) {
      // Removed here. Trash it on Drive too, unless someone has worked on it
      // there since: then their copy comes back down as a new story.
      if (!file) {
        ops.push({ op: "forget", storyId });
      } else if (remoteChanged) {
        ops.push({ op: "download", storyId, fileId: file.id, file });
      } else {
        ops.push({ op: "trashRemote", storyId, fileId: file.id, file });
      }
      continue;
    }

    if (story && file) {
      if (localChanged && remoteChanged) {
        ops.push({ op: "downloadCopy", storyId, fileId: file.id, file });
        ops.push({ op: "upload", storyId, fileId: file.id });
      } else if (localChanged) {
        ops.push({ op: "upload", storyId, fileId: file.id });
      } else if (remoteChanged) {
        ops.push({ op: "download", storyId, fileId: file.id, file });
      }
      continue;
    }

    if (story && !file) {
      if (!rec) {
        ops.push({ op: "upload", storyId, fileId: null });
      } else if (localChanged) {
        // Gone from Drive but edited here since: the edit wins, as a new file.
        ops.push({ op: "upload", storyId, fileId: null });
      } else {
        ops.push({ op: "deleteLocal", storyId, fileId: rec.fileId });
      }
      continue;
    }

    if (!story && file) {
      // Nothing here by that id. Either it is new from another device, or
      // it was deleted here before sync ever saw it (no record): bring it in.
      ops.push({ op: "download", storyId, fileId: file.id, file });
      continue;
    }

    // Neither side has it any more.
    if (rec) ops.push({ op: "forget", storyId });
  }

  return ops;
}
