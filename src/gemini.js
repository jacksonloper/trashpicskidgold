const STYLE_PREFIX =
  "Children's book illustration in a warm, whimsical watercolor style with soft edges and bright cheerful colors. Simple, rounded shapes suitable for ages 4-7.";

const MODEL = "gemini-2.0-flash-preview-image-generation";

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
