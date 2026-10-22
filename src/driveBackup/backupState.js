/**
 * What the backup record says about a story, in one word, for the glyph
 * beside its title and the count in Settings. Pure.
 *
 *   waiting   never backed up, edited since its last upload, or sent but
 *             not yet checked (Drive had not finished hashing it)   ⏳
 *   differs   the last check found a file on Drive unlike the one here ❌
 *   verified  sent, and every file's checksum on Drive matches        ✅
 */
export function backupState(story, record) {
  if (!record) return "waiting";
  if ((story?.updatedAt ?? 0) > (record.syncedAt ?? 0)) return "waiting";
  if (record.mismatches?.length) return "differs";
  if (record.verifiedAt) return "verified";
  return "waiting";
}

export const BACKUP_GLYPH = { verified: "✅", waiting: "⏳", differs: "❌" };

/** { verified, waiting, differs } counts over a story list. */
export function tallyBackups(stories, recordsByStoryId) {
  const tally = { verified: 0, waiting: 0, differs: 0 };
  for (const s of stories ?? []) tally[backupState(s, recordsByStoryId?.[s.id])]++;
  return tally;
}
