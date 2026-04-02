#!/usr/bin/env node
/**
 * Generate example story images using the Gemini API.
 *
 * Usage:
 *   GEMINI_APIKEY=<key> node scripts/generate-example.mjs
 *
 * Outputs PNG files into public/example/.
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public", "example");

const API_KEY = process.env.GEMINI_APIKEY;
if (!API_KEY) {
  console.error("Error: set GEMINI_APIKEY environment variable");
  process.exit(1);
}

const MODEL = "gemini-3-pro-image-preview";

const STYLE_PREFIX =
  "Children's book illustration in a warm, whimsical watercolor style with soft edges and bright cheerful colors. Simple, rounded shapes suitable for ages 4-7.";

const CHARACTERS = [
  { name: "Luna", description: "A curious little fox with a fluffy orange tail and big purple eyes, wearing a small blue bandana" },
  { name: "Bramble", description: "A friendly hedgehog wearing tiny round glasses and a cozy green scarf" },
  { name: "Pip", description: "A cheerful bluebird with bright feathers and a tiny red hat" },
];

const CHAR_SHEET_PROMPT =
  `${STYLE_PREFIX} Character model sheet with a clean white background. ` +
  `Show exactly 3 characters side by side, each clearly labeled with their name below. ` +
  `Each character shown from the front, in a simple standing pose.\n` +
  `The characters are:\n` +
  CHARACTERS.map((c) => `${c.name}: ${c.description}`).join("\n") +
  `\nSimple clean design, no background scenery, just the characters on white.`;

const ILLUSTRATIONS = [
  {
    file: "illustration-1.png",
    caption: "Luna, Bramble, and Pip gathered around a cozy campfire in a forest clearing as a bright shooting star streaks across the night sky",
  },
  {
    file: "illustration-2.png",
    caption: "The three friends walking along a moonlit forest path, following a trail of tiny sparkles on the ground",
  },
  {
    file: "illustration-3.png",
    caption: "Luna, Bramble, and Pip discovering a softly glowing golden star nestled in a bed of colorful wildflowers",
  },
];

/* ---- Gemini helpers ---- */

async function callGemini(parts, retries = 3) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
  const body = {
    contents: [{ parts }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      if (attempt < retries && (res.status === 503 || res.status === 429)) {
        const wait = attempt * 15;
        console.log(`  ⏳ ${res.status} — retrying in ${wait}s (attempt ${attempt}/${retries})…`);
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      throw new Error(`Gemini API error ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const candidates = data.candidates || [];
    for (const c of candidates) {
      for (const part of c.content?.parts || []) {
        if (part.inlineData) {
          return Buffer.from(part.inlineData.data, "base64");
        }
      }
    }
    throw new Error("No image in Gemini response");
  }
}

async function generateImage(prompt) {
  return callGemini([{ text: prompt }]);
}

async function generateImageWithRef(prompt, refBuffer) {
  return callGemini([
    { text: prompt },
    { inlineData: { mimeType: "image/png", data: refBuffer.toString("base64") } },
  ]);
}

/* ---- Main ---- */

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  // 1. Generate character sheet
  const sheetPath = join(OUT_DIR, "character-sheet.png");
  let sheet;
  if (existsSync(sheetPath)) {
    console.log("Character sheet already exists, skipping…");
    sheet = readFileSync(sheetPath);
  } else {
    console.log("Generating character sheet…");
    sheet = await generateImage(CHAR_SHEET_PROMPT);
    writeFileSync(sheetPath, sheet);
    console.log(`  ✓ ${sheetPath}`);
  }

  // 2. Generate illustrations (using character sheet as reference)
  for (const ill of ILLUSTRATIONS) {
    const outPath = join(OUT_DIR, ill.file);
    if (existsSync(outPath)) {
      console.log(`${ill.file} already exists, skipping…`);
      continue;
    }
    console.log(`Generating ${ill.file}…`);
    const charNames = CHARACTERS.map((c) => c.name).join(", ");
    const prompt =
      `${STYLE_PREFIX} Full-page story illustration.\n` +
      `The characters in this story are: ${charNames}. ` +
      `Use the attached character model sheet as a visual reference so every character looks consistent.\n` +
      `Scene: ${ill.caption}`;

    const buf = await generateImageWithRef(prompt, sheet);
    writeFileSync(outPath, buf);
    console.log(`  ✓ ${outPath}`);
  }

  console.log("\nDone! All example images generated.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
