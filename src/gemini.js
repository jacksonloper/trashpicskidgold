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

/* ---- when the reply has nothing in it ---- */

/**
 * A failure with the reply that caused it attached.
 *
 * "No picture came back" is all the banner can say on one line, and it is
 * never the whole story.  The reply that arrived says which of the handful of
 * quite different things happened: the prompt was refused before anything was
 * drawn, the model ran out of room, the picture was made and then held back,
 * or the model answered in words.  Each one wants something different from the
 * grown-up, and none of it survives `err.message`.
 *
 * So the detail rides along on the error, and the banner offers it behind a
 * click rather than either dumping it on screen or throwing it away.
 *
 * `details` is what the details dialog renders:
 *   { title, what, facts: [{label, value}], saidInstead, tryThis: [], raw }
 */
export class GeminiError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "GeminiError";
    this.details = details;
  }
}

/** Swap base64 payloads for their size: a reply is meant to be readable. */
function withoutImageData(value) {
  if (Array.isArray(value)) return value.map(withoutImageData);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] =
        k === "data" && typeof v === "string" && v.length > 256
          ? `[${Math.round((v.length * 3) / 4 / 1024)} KB of image data]`
          : withoutImageData(v);
    }
    return out;
  }
  return value;
}

const RAW_LIMIT = 20000;

/** The reply as text to read, copy and paste into a bug report. */
function rawReply(data) {
  let text;
  try {
    text =
      typeof data === "string"
        ? data
        : JSON.stringify(withoutImageData(data), null, 2);
  } catch {
    text = String(data);
  }
  // Nothing should carry the key this far — it travels in the URL, not the
  // reply — but this text is about to be shown and copied around, so a reply
  // that quotes the request back doesn't get to leak it.
  text = text.replace(/([?&]key=)[^"&\s]+/g, "$1...");
  return text.length > RAW_LIMIT
    ? text.slice(0, RAW_LIMIT) + "\n\n[...truncated]"
    : text;
}

/*
 * Why a reply stopped, in words a parent can act on.
 *
 * Keyed by the `finishReason` on the candidate — what happened while the model
 * was working — and by `promptFeedback.blockReason`, which means it never
 * started.  Anything not listed here still shows its raw code in the facts.
 */
const FINISH_REASONS = {
  SAFETY: {
    what: "Gemini's safety filter stopped the reply partway through.",
    tryThis: [
      "Reword the caption. One word that reads as grown-up or violent out of context is usually the whole cause.",
      "Try the other model in the picker — the two filters don't always agree.",
    ],
  },
  IMAGE_SAFETY: {
    what: "Gemini drew something and then its safety filter held the picture back.",
    tryThis: [
      "Reword the caption, and check the character descriptions the plan pulled in — the picture, not the words, is what was judged here.",
      "Try the other model in the picker.",
    ],
  },
  PROHIBITED_CONTENT: {
    what: "Gemini refused this one outright: it read the request as something it will not draw.",
    tryThis: [
      "Reword the caption and the character descriptions in plainer terms.",
    ],
  },
  BLOCKLIST: {
    what: "The request used a term on Google's blocklist.",
    tryThis: ["Reword the caption, then the character descriptions."],
  },
  SPII: {
    what: "Gemini read something in the request as somebody's private information.",
    tryThis: [
      "Take real names, addresses and the like out of the captions and descriptions.",
    ],
  },
  RECITATION: {
    what: "Gemini stopped because the reply was reproducing material it was trained on.",
    tryThis: [
      "Reword the caption in your own words, especially if it quotes a book or names a character from one.",
    ],
  },
  MAX_TOKENS: {
    what: "Gemini ran out of room before it finished.",
    tryThis: [
      "Try the Fast model, which is less talkative.",
      "Shorten the story, or the captions it has to read through.",
    ],
  },
  LANGUAGE: {
    what: "Gemini doesn't support the language the request was written in.",
    tryThis: ["Try the caption in English."],
  },
  OTHER: {
    what: "Gemini stopped for a reason it didn't name.",
    tryThis: [
      "Try again. This one is often nothing worse than a bad minute at Google's end.",
    ],
  },
};

const BLOCK_REASONS = {
  SAFETY: {
    what: "Gemini's safety filter refused the request before anything was drawn.",
    tryThis: [
      "Reword the caption. One word that reads as grown-up or violent out of context is usually the whole cause.",
      "Try the other model in the picker — the two filters don't always agree.",
    ],
  },
  BLOCKLIST: {
    what: "The request used a term on Google's blocklist, so nothing was drawn.",
    tryThis: ["Reword the caption, then the character descriptions."],
  },
  PROHIBITED_CONTENT: {
    what: "Gemini refused the request outright: it read it as something it will not draw.",
    tryThis: [
      "Reword the caption and the character descriptions in plainer terms.",
    ],
  },
  OTHER: {
    what: "Gemini refused the request without saying why.",
    tryThis: ["Try again, and reword the caption if it happens twice."],
  },
};

/** "HARM_CATEGORY_SEXUALLY_EXPLICIT" -> "Sexually explicit". */
function prettyCategory(category) {
  const words = String(category || "")
    .replace(/^HARM_CATEGORY_/, "")
    .toLowerCase()
    .replace(/_/g, " ");
  return words ? words[0].toUpperCase() + words.slice(1) : "Safety rating";
}

/**
 * Pull out everything a human would want to know about a reply.
 *
 * @returns {{facts:Array<{label:string,value:string}>, said:string,
 *            finishReason:string|null, blockReason:string|null}}
 */
function readReply(data, model) {
  const candidate = data?.candidates?.[0];
  const finishReason = candidate?.finishReason ?? null;
  const blockReason = data?.promptFeedback?.blockReason ?? null;

  // What the model wrote, as opposed to drew.  A refusal usually arrives as
  // exactly this: a polite paragraph where the picture should be.
  const said = (candidate?.content?.parts ?? [])
    .filter((p) => typeof p.text === "string" && !p.thought)
    .map((p) => p.text)
    .join("")
    .trim();

  const facts = [{ label: "Model", value: model }];
  if (blockReason) facts.push({ label: "Request blocked", value: blockReason });
  const blockNote = data?.promptFeedback?.blockReasonMessage;
  if (blockNote) facts.push({ label: "Google's note", value: blockNote });
  facts.push({
    label: "Finish reason",
    value: finishReason || "not given",
  });
  if (!data?.candidates?.length) {
    facts.push({ label: "Answers", value: "none — the reply was empty" });
  }
  // Only the ratings that had something to say; every reply carries a full set
  // of NEGLIGIBLE ones and listing those buries the one that matters.
  for (const r of [
    ...(data?.promptFeedback?.safetyRatings ?? []),
    ...(candidate?.safetyRatings ?? []),
  ]) {
    if (!r?.blocked && (!r?.probability || r.probability === "NEGLIGIBLE"))
      continue;
    facts.push({
      label: prettyCategory(r.category),
      value: `${r.probability ?? "flagged"}${r.blocked ? " — blocked" : ""}`,
    });
  }
  const used = data?.usageMetadata?.totalTokenCount;
  if (used) facts.push({ label: "Tokens used", value: String(used) });

  return { facts, said, finishReason, blockReason };
}

/** Trim a sentence out of a long message for the one line the banner gets. */
function firstSentence(text, limit = 140) {
  const flat = String(text).replace(/\s+/g, " ").trim();
  const stop = flat.search(/\.\s|\.$/);
  const cut = stop > 0 && stop < limit ? stop + 1 : Math.min(flat.length, limit);
  return flat.slice(0, cut) + (cut < flat.length ? "..." : "");
}

/**
 * The reply arrived and there was no picture in it.
 *
 * @param {object} data  – parsed generateContent response
 * @param {string} model
 * @returns {GeminiError}
 */
function noImageError(data, model) {
  const { facts, said, finishReason, blockReason } = readReply(data, model);
  const reason =
    BLOCK_REASONS[blockReason] ??
    (finishReason && finishReason !== "STOP"
      ? FINISH_REASONS[finishReason]
      : null);

  let message;
  if (blockReason) {
    message = `Gemini wouldn't draw this one — the request was blocked (${blockReason}).`;
  } else if (finishReason && finishReason !== "STOP") {
    message = `Gemini stopped before the picture was finished (${finishReason}).`;
  } else if (said) {
    message = "Gemini answered in words instead of drawing a picture.";
  } else {
    message = "Gemini sent a reply with no picture in it.";
  }

  return new GeminiError(message, {
    title: "No picture came back",
    what:
      reason?.what ??
      (said
        ? "Gemini finished normally but wrote a reply instead of drawing anything. What it wrote is below, and it usually says why."
        : "Gemini finished normally and sent back neither a picture nor any words explaining itself. That is unusual enough that the whole reply is below."),
    facts,
    saidInstead: said || null,
    tryThis: reason?.tryThis ?? [
      "Try again — nothing in your story was changed.",
      "If it happens twice, reword the caption, or try the other model in the picker.",
    ],
    raw: rawReply(data),
  });
}

/**
 * The planner's reply arrived with no text in it at all.
 *
 * @param {object} data
 * @param {string} model
 * @returns {GeminiError}
 */
function noTextError(data, model) {
  const { facts, finishReason, blockReason } = readReply(data, model);
  const reason =
    BLOCK_REASONS[blockReason] ??
    (finishReason && finishReason !== "STOP"
      ? FINISH_REASONS[finishReason]
      : null);

  const message = blockReason
    ? `The planning model wouldn't answer — the request was blocked (${blockReason}). Nothing in your story was changed.`
    : `The planning model returned no text${
        finishReason && finishReason !== "STOP" ? ` (${finishReason})` : ""
      }. Nothing in your story was changed.`;

  return new GeminiError(message, {
    title: "The plan came back empty",
    what:
      reason?.what ??
      "The planning model answered, but its answer had no words in it, so there was no plan to read.",
    facts,
    saidInstead: null,
    tryThis: reason?.tryThis ?? [
      "Try again — nothing in your story was changed.",
      "If it happens twice, try the other planning model.",
    ],
    raw: rawReply(data),
  });
}

/*
 * What the HTTP status means, when the call never got as far as a reply.
 * These are the ones a BYOK app actually meets: a key that is wrong, a key
 * that has run out, a model that has been retired, a bad afternoon at Google.
 */
const HTTP_REASONS = {
  400: {
    what: "Gemini rejected the request itself.",
    tryThis: [
      "Check the API key in the key box — a truncated paste lands here.",
      "The note from Google below usually names the exact field it didn't like.",
    ],
  },
  401: {
    what: "Gemini wouldn't accept the API key.",
    tryThis: [
      "Paste the key again — it's the likeliest cause, and nothing else in the app can go wrong this way.",
      "Make sure the key is a Gemini API key from aistudio.google.com, not another Google key.",
    ],
  },
  403: {
    what: "The API key was understood and turned down.",
    tryThis: [
      "Check that the key's project has the Generative Language API enabled.",
      "Some models need billing switched on for the key's project.",
    ],
  },
  404: {
    what: "Gemini has no model by that name.",
    tryThis: [
      "Pick the other model in the picker — preview models get retired without notice.",
    ],
  },
  429: {
    what: "The key has hit its rate limit or run out of quota.",
    tryThis: [
      "Wait a minute and try again. A free key allows only a few pictures an hour.",
      "If it keeps happening, the key's project needs billing switched on.",
    ],
  },
  500: {
    what: "Something broke at Google's end.",
    tryThis: ["Try again in a minute. Nothing in your story was changed."],
  },
  503: {
    what: "Gemini is overloaded right now.",
    tryThis: [
      "Try again in a minute.",
      "The Fast model is usually the one with room.",
    ],
  },
};

/**
 * Throw for a response that never got as far as a reply.
 *
 * The whole error body used to go straight onto the banner, which is how a
 * quota message became three hundred characters of JSON across the bottom of
 * the screen.  The line is the sentence Google wrote; the JSON is a click away.
 *
 * @param {Response} res
 * @param {string} model
 * @param {string} doing – what was being attempted, e.g. "draw the picture"
 */
async function throwForStatus(res, model, doing) {
  const body = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    // Some failures come back as HTML from a proxy rather than Google's JSON.
  }
  const googleSaid = parsed?.error?.message?.trim() || null;
  const reason = HTTP_REASONS[res.status] ?? null;

  const facts = [
    { label: "Model", value: model },
    {
      label: "HTTP status",
      value: `${res.status}${res.statusText ? ` ${res.statusText}` : ""}`,
    },
  ];
  if (parsed?.error?.status)
    facts.push({ label: "Google's code", value: parsed.error.status });
  if (googleSaid) facts.push({ label: "Google's note", value: googleSaid });

  throw new GeminiError(
    `Gemini couldn't ${doing}: ${
      googleSaid ? firstSentence(googleSaid) : `HTTP ${res.status}`
    }`,
    {
      title: "Gemini turned the request down",
      what:
        reason?.what ??
        "The request reached Google and came back as an error rather than a reply.",
      facts,
      saidInstead: null,
      tryThis: reason?.tryThis ?? [
        "Try again — nothing in your story was changed.",
      ],
      raw: rawReply(parsed ?? body),
    }
  );
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
 * A plan that couldn't be read, with the reply that couldn't be read attached.
 *
 * @param {string} message       – the line for the banner
 * @param {string} what          – what went wrong, for the details dialog
 * @param {string} raw           – the reply as it arrived
 * @param {string|null} finishReason
 * @returns {GeminiError}
 */
function damagedPlanError(message, what, raw, finishReason) {
  const stopped =
    finishReason && finishReason !== "STOP" ? FINISH_REASONS[finishReason] : null;
  return new GeminiError(message, {
    title: "The plan couldn't be read",
    what: stopped ? `${stopped.what} ${what}` : what,
    facts: [{ label: "Finish reason", value: finishReason || "not given" }],
    // The reply *is* what it wrote, and it's printed below as the raw reply;
    // showing it twice in one dialog would only make it look like two replies.
    saidInstead: null,
    tryThis: stopped?.tryThis ?? [
      "Try again — nothing in your story was changed.",
      "If it happens twice, try the other planning model.",
    ],
    raw: rawReply(raw),
  });
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
      throw damagedPlanError(
        "The planning model didn't return a prompt." +
          finishReasonNote(finishReason) +
          " Nothing in your story was changed — try again.",
        "The reply was readable, but the one field the app needs — the prompt to draw from — wasn't in it.",
        raw,
        finishReason
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

  throw damagedPlanError(
    "The planning model's reply wasn't valid JSON, so the illustration " +
      "couldn't be planned." +
      finishReasonNote(finishReason) +
      " Nothing in your story was changed — try again.",
    "The planner is asked for a JSON object and answered with something else — " +
      "chatter around it, or a reply that was cut off mid-sentence. Not even " +
      "the prompt could be salvaged from what arrived.",
    raw,
    finishReason
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

  if (!res.ok) await throwForStatus(res, useModel, "plan the illustration");

  const data = await res.json();
  const { text, finishReason } = collectAnswerText(data);
  if (!text.trim()) throw noTextError(data, useModel);

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

  if (!res.ok) await throwForStatus(res, useModel, "draw the picture");

  const data = await res.json();
  return extractImageFromResponse(data, useModel);
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

  if (!res.ok) await throwForStatus(res, useModel, "draw the picture");

  const data = await res.json();
  return extractImageFromResponse(data, useModel);
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

  if (!res.ok) await throwForStatus(res, useModel, "draw the picture");

  const data = await res.json();
  return extractImageFromResponse(data, useModel);
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
 * @param {string} model – which model drew it, for the failure detail
 * @returns {string} data URL
 */
function extractImageFromResponse(data, model) {
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
  if (!chosen) throw noImageError(data, model);
  return `data:${chosen.mimeType};base64,${chosen.b64}`;
}
