/**
 * When each page was last edited.
 *
 * Every section carries `editedAt`, stamped whenever the section itself
 * changes — its words, its caption, its picture, its plan. Story updates are
 * immutable, so a section left alone keeps the very same object, and one that
 * isn't the same object as before has been edited (or is new). Moving a page
 * doesn't count: it's the story's order that changed, not the page.
 *
 * Pages from before this was kept have no stamp, and say so.
 */
export function stampEditedSections(prev, next) {
  const before = prev?.jsonblob?.sections;
  const after = next?.jsonblob?.sections;
  if (!after || before === after) return next;
  const old = new Map((before ?? []).map((sec) => [sec.id, sec]));
  const now = Date.now();
  let changed = false;
  const sections = after.map((sec) => {
    if (old.get(sec.id) === sec) return sec;
    // Put back by an undo: it is the page as it was, not a new edit.
    if (!old.has(sec.id) && sec.editedAt) return sec;
    changed = true;
    return { ...sec, editedAt: now };
  });
  return changed ? { ...next, jsonblob: { ...next.jsonblob, sections } } : next;
}

/** One section with a fresh stamp, for updates made outside `updateStory`. */
export function stampSection(sec) {
  return { ...sec, editedAt: Date.now() };
}

function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * A stamp as people say it: "today, 3:42 PM", "yesterday, 9:05 AM",
 * "Nov 3, 3:42 PM", and the year too once it isn't this one.
 * Null for a missing stamp.
 */
export function formatEdited(ts, now = new Date()) {
  if (!ts) return null;
  const d = new Date(ts);
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return `today, ${time}`;
  if (sameDay(d, yesterday)) return `yesterday, ${time}`;
  const date = d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
  return `${date}, ${time}`;
}
