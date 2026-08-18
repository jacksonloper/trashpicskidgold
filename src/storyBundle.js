/**
 * Story bundle format — the ZIP that Download produces and Import consumes.
 *
 * Layout (formatVersion 2):
 *
 *   story.json    { formatVersion, id, title, jsonblob }
 *   images.json   [ { id, storyId, caption, characterReferenceId, file } ]
 *   images/…      the image binaries, named for humans
 *   story.md      convenience rendering — ignored on import
 *
 * `images.json` is what makes the bundle round-trippable: image records are
 * keyed by id inside `jsonblob`, but the files in `images/` are named for
 * humans, so something has to carry the mapping.
 *
 * Version 1 bundles (produced before Import existed) had a bare `jsonblob` in
 * `story.json` and no `images.json`. They are still readable: file names carry
 * an ordinal prefix assigned from `collectImageIds`, which is the same
 * canonical ordering used today, so images can be matched back positionally.
 */

import JSZip from "jszip";
import { migrateStory } from "./db";

export const BUNDLE_FORMAT_VERSION = 2;

/* ---- data-URL helpers ---- */

export function dataUrlToBytes(dataUrl) {
  const [header, b64] = dataUrl.split(",");
  const mime = header.split(":")[1].split(";")[0];
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return { bytes, mime };
}

export function bytesToDataUrl(bytes, mime) {
  let binary = "";
  const chunk = 0x8000; // avoid blowing the argument limit on big images
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

export function extensionForMime(mime) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "png";
}

export function mimeForExtension(ext) {
  const e = ext.toLowerCase();
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  if (e === "webp") return "image/webp";
  if (e === "gif") return "image/gif";
  return "image/png";
}

export function sanitizeFilename(name, fallback) {
  return (name || fallback).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
}

export function slugify(s) {
  return (s || "story")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Every image id a story refers to, in a stable canonical order:
 * reference graphics first (in order), then illustration sections.
 *
 * Export numbers files by this order and v1 import relies on it, so the
 * ordering is part of the format — don't reorder it casually.
 */
export function collectImageIds(story) {
  const ids = [];
  const seen = new Set();
  const add = (id) => {
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  };

  const blob = story.jsonblob ?? {};
  for (const rg of blob.referenceGraphics ?? []) add(rg.imageId);
  add(blob.characterSheetImageId); // legacy
  for (const sec of blob.sections ?? []) {
    if (sec.type === "illustration") add(sec.imageId);
  }
  return ids;
}

/* ---- writing ---- */

/**
 * Build the bundle.
 *
 * `imageMap` is imageId → image record ({ id, storyId, caption, data, … }).
 * Ids with no record are skipped; the importer treats a reference with no
 * file as a panel whose artwork is gone.
 *
 * Returns { zip, imageFiles } — `imageFiles` is imageId → filename, which the
 * caller needs to build the Markdown rendering.
 */
export function buildStoryBundle(story, imageMap) {
  const zip = new JSZip();
  const imagesFolder = zip.folder("images");
  const imageFiles = {};
  const index = [];

  collectImageIds(story).forEach((id, counter) => {
    const rec = imageMap[id];
    if (!rec?.data) return;
    const { bytes, mime } = dataUrlToBytes(rec.data);
    const ext = extensionForMime(mime);
    const prefix = String(counter).padStart(2, "0");
    const filename = `${prefix}_${sanitizeFilename(rec.caption, id)}.${ext}`;
    imagesFolder.file(filename, bytes);
    imageFiles[id] = filename;
    index.push({
      id,
      storyId: rec.storyId ?? story.id,
      caption: rec.caption ?? "",
      characterReferenceId: rec.characterReferenceId ?? null,
      file: `images/${filename}`,
    });
  });

  zip.file(
    "story.json",
    JSON.stringify(
      {
        formatVersion: BUNDLE_FORMAT_VERSION,
        id: story.id,
        title: story.title,
        jsonblob: story.jsonblob,
      },
      null,
      2
    )
  );
  zip.file("images.json", JSON.stringify(index, null, 2));

  return { zip, imageFiles };
}

/* ---- reading ---- */

/**
 * Parse a bundle into { story, images }, where images carry data-URLs.
 * Accepts both formatVersion 2 and the older bare-jsonblob layout.
 *
 * Throws with a human-readable message when the file is not a bundle.
 */
export async function readStoryBundle(file) {
  let zip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new Error(`${file.name || "File"} is not a readable ZIP`);
  }

  const storyEntry = zip.file("story.json");
  if (!storyEntry) {
    throw new Error(`${file.name || "Bundle"} has no story.json`);
  }

  let parsed;
  try {
    parsed = JSON.parse(await storyEntry.async("string"));
  } catch {
    throw new Error(`${file.name || "Bundle"} has malformed story.json`);
  }

  // v2 carries the whole record; v1 stored the jsonblob alone.
  const isV2 = !!parsed.jsonblob;
  const jsonblob = isV2 ? parsed.jsonblob : parsed;
  if (!jsonblob || typeof jsonblob !== "object") {
    throw new Error(`${file.name || "Bundle"} has no story data`);
  }

  const story = {
    id: isV2 && parsed.id ? parsed.id : crypto.randomUUID(),
    title:
      (isV2 && parsed.title) ||
      (await titleFromMarkdown(zip)) ||
      "Imported Story",
    jsonblob,
  };

  const readFile = async (path) => {
    const entry = zip.file(path) || zip.file(path.replace(/^images\//, ""));
    if (!entry) return null;
    const bytes = await entry.async("uint8array");
    const ext = path.split(".").pop();
    return bytesToDataUrl(bytes, mimeForExtension(ext));
  };

  const images = [];
  const indexEntry = zip.file("images.json");

  if (indexEntry) {
    const index = JSON.parse(await indexEntry.async("string"));
    for (const rec of index) {
      const data = await readFile(rec.file);
      if (!data) continue;
      images.push({
        id: rec.id,
        storyId: story.id,
        caption: rec.caption ?? "",
        data,
        characterReferenceId: rec.characterReferenceId ?? null,
      });
    }
  } else {
    // v1: recover the mapping from the ordinal filename prefix.
    const ids = collectImageIds(story);
    const captions = captionsById(story);
    const files = Object.keys(zip.files).filter(
      (p) => p.startsWith("images/") && !zip.files[p].dir
    );
    for (const path of files) {
      const base = path.slice("images/".length);
      const m = /^(\d+)_/.exec(base);
      if (!m) continue;
      const id = ids[Number(m[1])];
      if (!id) continue;
      const data = await readFile(path);
      if (!data) continue;
      images.push({
        id,
        storyId: story.id,
        caption: captions[id] ?? "",
        data,
        characterReferenceId: null,
      });
    }
  }

  return { story, images };
}

/**
 * v1 bundles kept the title nowhere but the first heading of story.md,
 * so pull it back out of there rather than losing it.
 */
async function titleFromMarkdown(zip) {
  const md = zip.file("story.md");
  if (!md) return null;
  const text = await md.async("string");
  const m = /^#\s+(.+)$/m.exec(text);
  return m ? m[1].trim() : null;
}

/** Best-effort caption per image id, from the story itself. */
function captionsById(story) {
  const out = {};
  const blob = story.jsonblob ?? {};
  for (const rg of blob.referenceGraphics ?? []) {
    if (rg.imageId) out[rg.imageId] = rg.label ?? "";
  }
  for (const sec of blob.sections ?? []) {
    if (sec.type === "illustration" && sec.imageId) {
      out[sec.imageId] = sec.caption ?? "";
    }
  }
  return out;
}

/* ---- preparing a parsed bundle for the database ---- */

/**
 * Reconcile a parsed bundle against what is already stored.
 *
 * - When the story id is free, ids are preserved so a backup restores exactly.
 * - When it is taken, the import is treated as a copy: every id is reminted
 *   and all internal references are rewritten, so importing a bundle twice
 *   can never clobber the first copy.
 * - References to images the bundle does not carry are dropped, leaving the
 *   caption and prompt in place so the panel can simply be regenerated.
 *
 * Returns { story, images, remapped, droppedImageRefs }.
 */
export function prepareForImport({ story, images }, existingStoryIds) {
  // Normalise legacy layouts first, so everything below sees current shape
  // (notably characterSheetImageId folded into referenceGraphics).
  const migrated = migrateStory(story);

  const remapped = existingStoryIds.includes(migrated.id);

  const idMap = new Map();
  if (remapped) {
    for (const img of images) idMap.set(img.id, crypto.randomUUID());
  }
  const newId = (old) => (remapped ? idMap.get(old) : old);

  const available = new Set(images.map((i) => i.id));
  let droppedImageRefs = 0;

  const blob = migrated.jsonblob ?? {};
  const mapImageRef = (id) => {
    if (!id) return undefined;
    if (!available.has(id)) {
      droppedImageRefs++;
      return undefined;
    }
    return newId(id);
  };

  const storyId = remapped ? crypto.randomUUID() : migrated.id;

  const referenceGraphics = (blob.referenceGraphics ?? []).map((rg) => {
    const imageId = mapImageRef(rg.imageId);
    const next = {
      ...rg,
      id: remapped ? crypto.randomUUID() : rg.id,
      imageId,
    };
    if (!imageId) delete next.imageId;
    return next;
  });

  const sections = (blob.sections ?? []).map((sec) => {
    const next = { ...sec, id: remapped ? crypto.randomUUID() : sec.id };
    if (sec.type === "illustration") {
      const imageId = mapImageRef(sec.imageId);
      if (imageId) next.imageId = imageId;
      else delete next.imageId;
    }
    return next;
  });

  const nextBlob = { ...blob, referenceGraphics, sections };
  delete nextBlob.characterSheetImageId; // migrated into referenceGraphics

  return {
    story: {
      id: storyId,
      title: migrated.title || "Imported Story",
      jsonblob: nextBlob,
    },
    images: images.map((img) => ({
      ...img,
      id: newId(img.id),
      storyId,
      characterReferenceId: img.characterReferenceId
        ? (newId(img.characterReferenceId) ?? null)
        : null,
    })),
    remapped,
    droppedImageRefs,
  };
}
