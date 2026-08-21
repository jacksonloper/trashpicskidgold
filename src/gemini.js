const DEFAULT_IMAGE_MODEL = "gemini-3-pro-image-preview";
const DEFAULT_TEXT_MODEL = "gemini-3-pro-image-preview";

/** Model options for image generation. */
export const IMAGE_MODELS = [
  { id: "gemini-3-pro-image-preview", label: "Quality (slower)" },
  { id: "gemini-2.5-flash-image", label: "Fast" },
];

/** Model options for text-based planning. */
export const TEXT_MODELS = [
  { id: "gemini-3-pro-image-preview", label: "Quality (slower)" },
  { id: "gemini-2.5-flash", label: "Fast" },
];

/**
 * Build the complete prompt for generating a reference graphic.
 *
 * @param {string} style        – the user's illustration style description
 * @param {"character"|"scene"|"other"} kind
 * @param {string} userPrompt   – what the user typed
 * @param {string} [label]      – the reference graphic label (e.g. character name)
 * @returns {string}
 */
export function buildRefGraphicPrompt(style, kind, userPrompt, label) {
  if (kind === "character") {
    const nameClause = label ? `The character's name is "${label}". ` : "";
    return (
      `${style}\n\n` +
      `Character model sheet with a clean white background. ` +
      `${nameClause}` +
      `Show the character from the front in a simple standing pose.\n\n` +
      `${userPrompt}\n\n` +
      `Simple clean design, no background scenery, just the character on white. ` +
      `Do NOT include any text, labels, captions, or writing in the image.`
    );
  }
  if (kind === "scene") {
    return `${style}\n\nReference scene illustration.\n\n${userPrompt}`;
  }
  // "other"
  return `${style}\n\n${userPrompt}`;
}

/* ---- planner reply parsing ---- */

/**
 * Collect the answer text from a generateContent response.
 *
 * Gemini is free to split one answer across several `parts`, and thinking
 * models put their scratchpad in parts flagged `thought`.  Reading only the
 * first text part drops the rest of the reply on the floor, which is how a
 * perfectly good plan turns into "Expected ',' or '}' after property value
 * in JSON at position N" — the fragment ends cleanly in the middle.
 *
 * @param {object} data – parsed generateContent response
 * @returns {{text:string, finishReason:string|null}}
 */
function collectAnswerText(data) {
  const candidate = data.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const text = parts
    .filter((p) => typeof p.text === "string" && !p.thought)
    .map((p) => p.text)
    .join("");
  return { text, finishReason: candidate?.finishReason ?? null };
}

/** Unwrap ```json … ``` fencing, wherever in the reply it sits. */
function stripCodeFences(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
}

/**
 * Read a JSON string value out of text that does not parse as JSON.
 *
 * Walks the value character by character so an unterminated string (a reply
 * that was cut off) still gives back everything written so far, then trims
 * any dangling escape so the result can be unescaped.
 *
 * @returns {string|null} the unescaped value, or null if the key isn't there
 */
function salvageString(text, key) {
  const keyAt = text.indexOf(`"${key}"`);
  if (keyAt === -1) return null;
  const colon = text.indexOf(":", keyAt + key.length + 2);
  if (colon === -1) return null;

  let i = colon + 1;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] !== '"') return null;
  i++;

  let body = "";
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      body += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch === '"') break;
    body += ch;
    i++;
  }

  // A cut-off reply can end mid-escape ("\", "\u12"); shave the tail until
  // what's left is a legal JSON string.  Escapes are at most 6 characters.
  for (let cut = 0; cut <= 6 && cut <= body.length; cut++) {
    try {
      return JSON.parse(`"${body.slice(0, body.length - cut)}"`);
    } catch {
      // keep shaving
    }
  }
  return null;
}

/** Read the complete quoted strings out of an array field. */
function salvageStringArray(text, key) {
  const keyAt = text.indexOf(`"${key}"`);
  if (keyAt === -1) return [];
  const open = text.indexOf("[", keyAt);
  if (open === -1) return [];
  const close = text.indexOf("]", open);
  const body = text.slice(open + 1, close === -1 ? text.length : close);
  return [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)]
    .map((m) => {
      try {
        return JSON.parse(`"${m[1]}"`);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/** Human-readable tail for an error message when the model stopped early. */
function finishReasonNote(finishReason) {
  if (!finishReason || finishReason === "STOP") return "";
  if (finishReason === "MAX_TOKENS")
    return " The model hit its output limit — try the Fast planning model, or shorten the story.";
  return ` The model stopped early (${finishReason}).`;
}

/**
 * Turn the planner's reply into a plan.
 *
 * Strict JSON first.  Failing that, the object is dug out of any surrounding
 * chatter, and failing *that* the fields are salvaged by hand so a reply that
 * arrived damaged still gives the user something to edit rather than nothing
 * at all.  A salvaged plan is flagged `partial` so callers can insist on a
 * human look before spending an image generation on it.
 *
 * Exported for testing.
 *
 * @param {string} text          – raw reply text
 * @param {string|null} [finishReason]
 * @returns {{prompt:string, referenceImageIds:string[], partial:boolean}}
 */
export function parsePlannerReply(text, finishReason = null) {
  const raw = stripCodeFences(text ?? "");

  const shape = (plan, partial) => {
    const prompt = typeof plan.prompt === "string" ? plan.prompt.trim() : "";
    if (!prompt) {
      throw new Error(
        "The planning model didn't return a prompt." +
          finishReasonNote(finishReason) +
          " Nothing in your story was changed — try again."
      );
    }
    return {
      prompt,
      referenceImageIds: Array.isArray(plan.referenceImageIds)
        ? plan.referenceImageIds.filter((id) => typeof id === "string")
        : [],
      partial,
    };
  };

  try {
    return shape(JSON.parse(raw), false);
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
  }

  // Chatter around the object, or a trailing second object.
  const open = raw.indexOf("{");
  const close = raw.lastIndexOf("}");
  if (open !== -1 && close > open) {
    try {
      return shape(JSON.parse(raw.slice(open, close + 1)), false);
    } catch (err) {
      if (!(err instanceof SyntaxError)) throw err;
    }
  }

  const prompt = salvageString(raw, "prompt");
  if (prompt && prompt.trim()) {
    return shape(
      { prompt, referenceImageIds: salvageStringArray(raw, "referenceImageIds") },
      true
    );
  }

  throw new Error(
    "The planning model's reply wasn't valid JSON, so the illustration " +
      "couldn't be planned." +
      finishReasonNote(finishReason) +
      " Nothing in your story was changed — try again."
  );
}

/**
 * Query the Gemini chat completion to plan an illustration.
 *
 * Given the full story context, returns:
 *   { prompt: string, referenceImageIds: string[], partial: boolean }
 *
 * The prompt is a detailed image-generation prompt and referenceImageIds lists
 * which reference graphics and/or existing illustration image IDs should be
 * attached when generating.  `partial` is true when the reply arrived damaged
 * and the plan had to be salvaged, so the caller should have the user review
 * it before generating.
 *
 * @param {string} apiKey
 * @param {string} style         – illustration style description
 * @param {Array<{id:string, label:string, kind:string, imageId:string|null, prompt:string}>} referenceGraphics
 * @param {Array} sections       – story sections
 * @param {string} targetCaption – the caption for the illustration to generate
 * @param {Object<string,string>} allImages – imageId → dataUrl map of all loaded images
 * @param {string} [model]      – Gemini model to use (defaults to quality)
 * @returns {Promise<{prompt:string, referenceImageIds:string[], partial:boolean}>}
 */
export async function planIllustration(
  apiKey,
  style,
  referenceGraphics,
  sections,
  targetCaption,
  allImages,
  model
) {
  const storyText = sections
    .map((s) => {
      if (s.type === "markdown") return s.content;
      if (s.type === "illustration")
        return `[Illustration: ${s.caption || "(no caption)"}]`;
      return "";
    })
    .join("\n\n");

  const refsWithImages = referenceGraphics.filter((rg) => rg.imageId);

  const refLines = refsWithImages
    .map((rg) => {
      let line = `- imageId="${rg.imageId}", label="${rg.label}", kind="${rg.kind}"`;
      if (rg.prompt) {
        line += `, description="${rg.prompt}"`;
      }
      return line;
    })
    .join("\n");

  const illustrationLines = sections
    .filter((s) => s.type === "illustration" && s.imageId)
    .map((s) => `- imageId="${s.imageId}", caption="${s.caption}"`)
    .join("\n");

  const message =
    `You are helping create an illustration for a story book.\n\n` +
    `## Illustration style\n${style}\n\n` +
    `## Story so far\n${storyText || "(empty)"}\n\n` +
    `## Available reference graphics (images the artist has prepared)\n${refLines || "(none)"}\n\n` +
    `## Available existing illustrations already generated\n${illustrationLines || "(none)"}\n\n` +
    `## Task\nThe user wants to generate an illustration for this scene:\n"${targetCaption}"\n\n` +
    `Please produce a JSON object with exactly two keys:\n` +
    `1. "prompt" – a detailed image-generation prompt. ` +
    `Start the prompt with the illustration style above so every image is rendered consistently. ` +
    `If any reference graphics are available, describe the relevant characters/scenes by their visual appearance ` +
    `as described in the reference graphic descriptions and as shown in the attached reference images. ` +
    `Use these visual references to ensure accurate character descriptions (species, colors, clothing, features) ` +
    `in your prompt, and instruct the generator to use the attached reference images for visual consistency. ` +
    `Do NOT guess or invent visual details that are not present in the reference descriptions or images.\n` +
    `2. "referenceImageIds" – an array of imageId strings from the reference graphics and/or existing illustrations above ` +
    `that should be sent as visual context to the image generator. Include only images that are relevant to this scene.\n\n` +
    (refsWithImages.length > 0
      ? `The reference graphic images are attached below, each preceded by a label. Study them carefully before writing the prompt.\n\n`
      : ``) +
    `Respond ONLY with the JSON object, no extra text.`;

  // Build multimodal parts: text message + reference images
  const parts = [{ text: message }];

  // Attach reference graphic images so the planning model can see them
  const imgMap = allImages || {};
  for (const rg of refsWithImages) {
    const dataUrl = imgMap[rg.imageId];
    if (dataUrl) {
      parts.push({
        text: `[Reference image: "${rg.label}" (${rg.kind}), imageId="${rg.imageId}"]`,
      });
      const base64 = dataUrl.split(",")[1];
      const mimeType = dataUrl.split(";")[0].split(":")[1];
      parts.push({
        inlineData: { mimeType, data: base64 },
      });
    }
  }

  const useModel = model || DEFAULT_TEXT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${useModel}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts }],
    generationConfig: { responseMimeType: "application/json" },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const { text, finishReason } = collectAnswerText(data);
  if (!text.trim()) {
    throw new Error(
      "The planning model returned no text." +
        finishReasonNote(finishReason) +
        " Nothing in your story was changed — try again."
    );
  }

  return parsePlannerReply(text, finishReason);
}

/**
 * Call the Gemini API to generate an image (text-only prompt).
 * Returns a base64 PNG data URL.
 * @param {string} apiKey
 * @param {string} prompt
 * @param {string} [model] – Gemini model to use (defaults to quality)
 * @returns {Promise<string>} data URL
 */
export async function generateImage(apiKey, prompt, model) {
  const useModel = model || DEFAULT_IMAGE_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${useModel}:generateContent?key=${apiKey}`;

  const body = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return extractImageFromResponse(data);
}

/**
 * Call the Gemini API to generate an image using an existing image as reference.
 * Returns a base64 PNG data URL.
 * @param {string} apiKey
 * @param {string} prompt
 * @param {string} referenceImageBase64  base64 encoded image (no data-url prefix)
 * @param {string} mimeType
 * @param {string} [model] – Gemini model to use (defaults to quality)
 * @returns {Promise<string>} data URL
 */
export async function generateImageWithReference(
  apiKey,
  prompt,
  referenceImageBase64,
  mimeType = "image/png",
  model
) {
  const useModel = model || DEFAULT_IMAGE_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${useModel}:generateContent?key=${apiKey}`;

  const body = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType,
              data: referenceImageBase64,
            },
          },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return extractImageFromResponse(data);
}

/**
 * Call the Gemini API to generate an image using multiple existing images as
 * references.  If no reference images are provided, falls back to text-only.
 * Returns a base64 PNG data URL.
 *
 * @param {string} apiKey
 * @param {string} prompt
 * @param {Array<{base64:string, mimeType:string}>} referenceImages
 * @param {string} [model] – Gemini model to use (defaults to quality)
 * @returns {Promise<string>} data URL
 */
export async function generateImageWithReferences(
  apiKey,
  prompt,
  referenceImages = [],
  model
) {
  const useModel = model || DEFAULT_IMAGE_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${useModel}:generateContent?key=${apiKey}`;

  const parts = [{ text: prompt }];
  for (const img of referenceImages) {
    parts.push({
      inlineData: { mimeType: img.mimeType, data: img.base64 },
    });
  }

  const body = {
    contents: [{ parts }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return extractImageFromResponse(data);
}

/**
 * Extract the finished image from a Gemini generateContent response.
 *
 * Gemini 3's image models think in pictures: before the real image they emit
 * up to two interim drafts — testing composition and lighting — as parts
 * flagged `thought`.  Taking the first inlineData part hands back one of those
 * drafts, which is how a generation occasionally comes back looking nothing
 * like the prompt.  The finished image is the last one the model emits, so
 * prefer the last unflagged image and fall back to the last image of any kind
 * for models that don't flag their drafts.
 *
 * @param {object} data
 * @returns {string} data URL
 */
function extractImageFromResponse(data) {
  const images = [];
  for (const candidate of data.candidates || []) {
    for (const part of candidate.content?.parts || []) {
      if (part.inlineData?.data) {
        images.push({
          mimeType: part.inlineData.mimeType,
          b64: part.inlineData.data,
          thought: part.thought === true,
        });
      }
    }
  }

  const finished = images.filter((img) => !img.thought);
  const chosen = (finished.length > 0 ? finished : images).at(-1);
  if (!chosen) throw new Error("No image found in Gemini response");
  return `data:${chosen.mimeType};base64,${chosen.b64}`;
}
