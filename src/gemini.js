const STYLE_PREFIX =
  "Children's book illustration in a warm, whimsical watercolor style with soft edges and bright cheerful colors. Simple, rounded shapes suitable for ages 4-7.";

const MODEL = "gemini-3-pro-image-preview";

/**
 * Build the text prompt for the character model sheet.
 * @param {Array<{name:string, description:string}>} characters
 * @returns {string}
 */
export function buildCharacterSheetPrompt(characters) {
  const count = characters.length;
  const charLines = characters
    .map((c) => `${c.name}: ${c.description}`)
    .join("\n");

  return (
    `${STYLE_PREFIX} Character model sheet with a clean white background. ` +
    `Show exactly ${count} character${count > 1 ? "s" : ""} side by side, each clearly labeled with their name below. ` +
    `Each character shown from the front, in a simple standing pose.\n` +
    `The characters are:\n${charLines}\n` +
    `Simple clean design, no background scenery, just the character${count > 1 ? "s" : ""} on white.`
  );
}

/**
 * Build the text prompt for a story illustration.
 * @param {Array<{name:string, description:string}>} characters
 * @param {string} caption
 * @returns {string}
 */
export function buildIllustrationPrompt(characters, caption) {
  const charNames = characters.map((c) => c.name).join(", ");
  return (
    `${STYLE_PREFIX} Full-page story illustration.\n` +
    `The characters in this story are: ${charNames}. ` +
    `Use the attached character model sheet as a visual reference so every character looks consistent.\n` +
    `Scene: ${caption}`
  );
}

/**
 * Query the Gemini chat completion to plan an illustration.
 *
 * Given the full story context, returns a JSON object:
 *   { prompt: string, referenceImageIds: string[] }
 *
 * The prompt is a detailed image-generation prompt and referenceImageIds lists
 * which reference graphics and/or existing illustration image IDs should be
 * attached when generating.
 *
 * @param {string} apiKey
 * @param {Array<{name:string, description:string}>} characters
 * @param {Array<{id:string, label:string, imageId:string|null}>} referenceGraphics
 * @param {Array} sections  – story sections
 * @param {string} targetCaption – the caption for the illustration to generate
 * @returns {Promise<{prompt:string, referenceImageIds:string[]}>}
 */
export async function planIllustration(
  apiKey,
  characters,
  referenceGraphics,
  sections,
  targetCaption
) {
  const charLines = characters
    .map((c) => `- ${c.name}: ${c.description}`)
    .join("\n");

  const storyText = sections
    .map((s) => {
      if (s.type === "markdown") return s.content;
      if (s.type === "illustration")
        return `[Illustration: ${s.caption || "(no caption)"}]`;
      return "";
    })
    .join("\n\n");

  const refLines = referenceGraphics
    .filter((rg) => rg.imageId)
    .map((rg) => `- imageId="${rg.imageId}", label="${rg.label}"`)
    .join("\n");

  const illustrationLines = sections
    .filter((s) => s.type === "illustration" && s.imageId)
    .map((s) => `- imageId="${s.imageId}", caption="${s.caption}"`)
    .join("\n");

  const message =
    `You are helping create an illustration for a children's story book ` +
    `illustrated in a warm, whimsical watercolor style with soft edges and bright cheerful colors, ` +
    `simple rounded shapes suitable for ages 4-7.\n\n` +
    `## Characters\n${charLines || "(none defined)"}\n\n` +
    `## Story so far\n${storyText || "(empty)"}\n\n` +
    `## Available reference graphics (images the artist has prepared)\n${refLines || "(none)"}\n\n` +
    `## Available existing illustrations already generated\n${illustrationLines || "(none)"}\n\n` +
    `## Task\nThe user wants to generate an illustration for this scene:\n"${targetCaption}"\n\n` +
    `Please produce a JSON object with exactly two keys:\n` +
    `1. "prompt" – a detailed image-generation prompt in the children's book watercolor style described above. ` +
    `Mention relevant characters by appearance (not just name) so the image generator can render them. ` +
    `If reference graphics are available, instruct the generator to use the attached reference images for visual consistency.\n` +
    `2. "referenceImageIds" – an array of imageId strings from the reference graphics and/or existing illustrations above ` +
    `that should be sent as visual context to the image generator. Include only images that are relevant to this scene.\n\n` +
    `Respond ONLY with the JSON object, no extra text.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [{ text: message }] }],
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
  const textPart = data.candidates?.[0]?.content?.parts?.find((p) => p.text);
  if (!textPart) throw new Error("No text in Gemini planning response");

  // Strip possible markdown fences
  const raw = textPart.text
    .replace(/^```json\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const plan = JSON.parse(raw);

  return {
    prompt: plan.prompt ?? "",
    referenceImageIds: Array.isArray(plan.referenceImageIds)
      ? plan.referenceImageIds
      : [],
  };
}

/**
 * Call the Gemini API to generate an image (text-only prompt).
 * Returns a base64 PNG data URL.
 * @param {string} apiKey
 * @param {string} prompt
 * @returns {Promise<string>} data URL
 */
export async function generateImage(apiKey, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

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
 * @returns {Promise<string>} data URL
 */
export async function generateImageWithReference(
  apiKey,
  prompt,
  referenceImageBase64,
  mimeType = "image/png"
) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

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
 * @returns {Promise<string>} data URL
 */
export async function generateImageWithReferences(
  apiKey,
  prompt,
  referenceImages = []
) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

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
 * Extract the first image from a Gemini generateContent response.
 * @param {object} data
 * @returns {string} data URL
 */
function extractImageFromResponse(data) {
  const candidates = data.candidates || [];
  for (const candidate of candidates) {
    const parts = candidate.content?.parts || [];
    for (const part of parts) {
      if (part.inlineData) {
        const { mimeType, data: b64 } = part.inlineData;
        return `data:${mimeType};base64,${b64}`;
      }
    }
  }
  throw new Error("No image found in Gemini response");
}
