import JSZip from "jszip";
import { getImage } from "../db";

/**
 * Convert a data-URL to a Uint8Array + mime string.
 */
function dataUrlToBytes(dataUrl) {
  const [header, b64] = dataUrl.split(",");
  const mime = header.split(":")[1].split(";")[0];
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return { bytes, mime };
}

function extensionForMime(mime) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "png";
}

/**
 * Gather all image ids referenced by a story and return them loaded.
 */
async function loadStoryImageMap(story) {
  const ids = new Set();
  const blob = story.jsonblob;
  if (blob.characterSheetImageId) ids.add(blob.characterSheetImageId);
  for (const sec of blob.sections) {
    if (sec.type === "illustration" && sec.imageId) ids.add(sec.imageId);
  }
  const map = {};
  for (const id of ids) {
    const rec = await getImage(id);
    if (rec) map[id] = rec;
  }
  return map;
}

/**
 * Build a convenience Markdown string for the story.
 */
function buildMarkdown(story, imageFiles) {
  const blob = story.jsonblob;
  const lines = [`# ${story.title}`, ""];

  if (blob.characterSheetImageId && imageFiles[blob.characterSheetImageId]) {
    lines.push(
      `![Character Sheet](images/${imageFiles[blob.characterSheetImageId]})`,
      ""
    );
  }

  for (const sec of blob.sections) {
    if (sec.type === "markdown") {
      lines.push(sec.content, "");
    } else if (sec.type === "illustration") {
      if (sec.imageId && imageFiles[sec.imageId]) {
        lines.push(`![${sec.caption}](images/${imageFiles[sec.imageId]})`, "");
      }
      if (sec.caption) lines.push(`*${sec.caption}*`, "");
    }
  }

  return lines.join("\n");
}

function sanitizeFilename(name, fallback) {
  return (name || fallback).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
}

/**
 * Export story as a ZIP (story.json + images/ + story.md).
 */
async function exportToZip(story) {
  const zip = new JSZip();
  const imageMap = await loadStoryImageMap(story);
  const imageFiles = {}; // imageId -> filename

  // Add images
  const imagesFolder = zip.folder("images");
  let counter = 0;
  for (const [id, rec] of Object.entries(imageMap)) {
    const { bytes, mime } = dataUrlToBytes(rec.data);
    const ext = extensionForMime(mime);
    const prefix = String(counter).padStart(2, "0");
    const filename = `${prefix}_${sanitizeFilename(rec.caption, id)}.${ext}`;
    imagesFolder.file(filename, bytes);
    imageFiles[id] = filename;
    counter++;
  }

  // Add story.json
  zip.file("story.json", JSON.stringify(story.jsonblob, null, 2));

  // Add convenience markdown
  zip.file("story.md", buildMarkdown(story, imageFiles));

  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(blob, `${slugify(story.title)}.zip`);
}

/**
 * Export story as a standalone HTML file.
 */
async function exportToHtml(story) {
  const imageMap = await loadStoryImageMap(story);
  const blob = story.jsonblob;

  let body = `<h1>${escHtml(story.title)}</h1>\n`;

  if (blob.characterSheetImageId && imageMap[blob.characterSheetImageId]) {
    body += `<div class="img-wrap"><img src="${imageMap[blob.characterSheetImageId].data}" alt="Character Sheet"></div>\n`;
  }

  for (const sec of blob.sections) {
    if (sec.type === "markdown") {
      // Render markdown as preformatted paragraphs (simple)
      body += `<div class="text-block">${escHtml(sec.content).replace(/\n/g, "<br>")}</div>\n`;
    } else if (sec.type === "illustration") {
      if (sec.imageId && imageMap[sec.imageId]) {
        body += `<div class="img-wrap"><img src="${imageMap[sec.imageId].data}" alt="${escHtml(sec.caption)}"></div>\n`;
      }
      if (sec.caption) {
        body += `<p class="caption"><em>${escHtml(sec.caption)}</em></p>\n`;
      }
    }
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(story.title)}</title>
<style>
  body { font-family: Georgia, serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; color: #333; background: #fefefe; }
  h1 { text-align: center; }
  .img-wrap { text-align: center; margin: 1.5rem 0; }
  .img-wrap img { max-width: 100%; border-radius: 8px; }
  .text-block { margin: 1.5rem 0; line-height: 1.7; }
  .caption { text-align: center; color: #666; }
</style>
</head>
<body>
${body}
</body>
</html>`;

  const blob2 = new Blob([html], { type: "text/html" });
  downloadBlob(blob2, `${slugify(story.title)}.html`);
}

/* ---- helpers ---- */

function escHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slugify(s) {
  return (s || "story")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

export default function ExportButtons({ story }) {
  if (!story) return null;

  return (
    <section className="card export-section">
      <h2>💾 Export</h2>
      <p className="section-description">
        Download your story for safekeeping.
      </p>
      <div className="export-row">
        <button
          type="button"
          className="btn-primary"
          onClick={() => exportToZip(story)}
        >
          📦 Download ZIP
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => exportToHtml(story)}
        >
          🌐 Save as HTML
        </button>
      </div>
    </section>
  );
}
