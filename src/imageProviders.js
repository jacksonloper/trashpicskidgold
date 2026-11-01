/*
 * The one place that knows there are two ways to draw a picture.
 *
 * Gemini draws from a prompt and the reference pictures the planner picked;
 * Stability's models on Bedrock draw from the prompt alone. Each needs its
 * own key. The pickers show both sets of models in one list, so a model id
 * is enough to say which provider, which key and which call.
 */

import {
  IMAGE_MODELS as GEMINI_IMAGE_MODELS,
  generateImageWithReferences,
} from "./gemini";
import {
  IMAGE_MODELS as BEDROCK_IMAGE_MODELS,
  generateImage as bedrockGenerateImage,
} from "./bedrock";

/** The image models, grouped the way the pickers show them. */
export const IMAGE_MODEL_GROUPS = [
  { provider: "gemini", label: "Gemini", models: GEMINI_IMAGE_MODELS },
  { provider: "bedrock", label: "AWS Bedrock", models: BEDROCK_IMAGE_MODELS },
];

/** Every image model, in picker order, each tagged with its provider. */
export const IMAGE_MODELS = IMAGE_MODEL_GROUPS.flatMap((g) =>
  g.models.map((m) => ({ ...m, provider: g.provider }))
);

/** Which provider draws with `modelId`. An unknown id is Gemini's. */
export function imageModelProvider(modelId) {
  return IMAGE_MODELS.find((m) => m.id === modelId)?.provider ?? "gemini";
}

/** Whether the model looks at reference pictures, or only reads the prompt. */
export function takesReferenceImages(modelId) {
  return imageModelProvider(modelId) === "gemini";
}

/** The picker's label for a model id, for a note that names it. */
export function imageModelLabel(modelId) {
  return IMAGE_MODELS.find((m) => m.id === modelId)?.label ?? modelId;
}

/**
 * The key for this provider was never pasted. Said plainly, with the fix, in
 * the shape the details dialog renders.
 */
function missingKeyError(provider, modelId) {
  const label = imageModelLabel(modelId);
  if (provider === "bedrock") {
    return Object.assign(
      new Error(`${label} needs an AWS Bedrock API key — paste one in the key box.`),
      {
        details: {
          title: "No Bedrock key",
          what: `${label} is one of Stability AI's models on Amazon Bedrock, and the app has no Bedrock API key to call it with.`,
          facts: [{ label: "Model", value: modelId }],
          saidInstead: null,
          tryThis: [
            "Open \"Also draw with AWS Bedrock\" under the Gemini key box and paste a Bedrock API key there.",
            "Or pick a Gemini model in the picker instead.",
          ],
          raw: null,
        },
      }
    );
  }
  return Object.assign(
    new Error(`${label} needs a Gemini API key — paste one in the key box.`),
    {
      details: {
        title: "No Gemini key",
        what: `${label} is a Gemini model, and the app has no Gemini API key to call it with.`,
        facts: [{ label: "Model", value: modelId }],
        saidInstead: null,
        tryThis: [
          "Paste a Gemini API key in the key box at the top.",
          "Or pick an AWS Bedrock model in the picker, if you have a Bedrock key.",
        ],
        raw: null,
      },
    }
  );
}

/**
 * Draw a picture with whichever provider owns the model.
 *
 * Reference pictures go to Gemini and are left out for Bedrock, whose models
 * can't take them; the plan review modal says so beside the picker.
 *
 * @param {{gemini:string, bedrock:string}} keys – the pasted API keys
 * @param {string} prompt
 * @param {Array<{base64:string, mimeType:string}>} referenceImages
 * @param {string} [modelId]
 * @returns {Promise<string>} data URL
 */
export async function drawPicture(keys, prompt, referenceImages, modelId) {
  const provider = imageModelProvider(modelId);
  const key = (keys?.[provider] ?? "").trim();
  if (!key) throw missingKeyError(provider, modelId);
  if (provider === "bedrock") return bedrockGenerateImage(key, prompt, modelId);
  return generateImageWithReferences(key, prompt, referenceImages, modelId);
}
