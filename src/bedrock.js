/*
 * Drawing with Amazon Bedrock: Stability AI's image models, called straight
 * from the browser with a Bedrock API key, the way gemini.js calls Gemini
 * with a Gemini key. Nothing goes through a server of ours.
 *
 * Why it is a second provider rather than a second entry in the Gemini
 * picker: the request, the reply and the ways it fails are all different,
 * and these models take no reference pictures — the prompt is everything
 * they see. Planning and reading aloud stay with Gemini.
 *
 * The runtime endpoint answers a browser's CORS preflight for any origin and
 * accepts `Authorization: Bearer <api key>`, so a plain fetch is enough: no
 * AWS SDK, no request signing. Text-to-image is served from us-west-2 only.
 */

const REGION = "us-west-2";

/**
 * Model options for image generation, in the order the picker shows them.
 * All three take the same request and give the same reply.
 */
export const IMAGE_MODELS = [
  { id: "stability.stable-image-core-v1:1", label: "Stable Image Core (fast)" },
  { id: "stability.sd3-5-large-v1:0", label: "Stable Diffusion 3.5 Large" },
  { id: "stability.stable-image-ultra-v1:1", label: "Stable Image Ultra (slow)" },
];

/** True if `id` is one of ours — the picker mixes providers in one list. */
export function isBedrockModel(id) {
  return IMAGE_MODELS.some((m) => m.id === id);
}

/*
 * These models are quick to letter a picture — a caption, a signature, a
 * watermark — which is the one thing a storybook page never wants.
 */
const NEGATIVE_PROMPT = "text, words, letters, caption, watermark, signature";

/**
 * A failure with what Bedrock sent attached, in the shape the details dialog
 * renders (the same one GeminiError uses):
 *   { title, what, facts: [{label, value}], saidInstead, tryThis: [], raw }
 */
export class BedrockError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "BedrockError";
    this.details = details;
  }
}

const RAW_LIMIT = 20000;

/** The reply as text to read and copy, with the picture itself left out. */
function rawReply(data) {
  let text;
  try {
    const shown =
      data && typeof data === "object" && Array.isArray(data.images)
        ? {
            ...data,
            images: data.images.map(
              (b64) => `[${Math.round((b64.length * 3) / 4 / 1024)} KB of image data]`
            ),
          }
        : data;
    text = typeof shown === "string" ? shown : JSON.stringify(shown, null, 2);
  } catch {
    text = String(data);
  }
  return text.length > RAW_LIMIT
    ? text.slice(0, RAW_LIMIT) + "\n\n[...truncated]"
    : text;
}

/** Trim a sentence out of a long message for the one line the banner gets. */
function firstSentence(text, limit = 140) {
  const flat = String(text).replace(/\s+/g, " ").trim();
  const stop = flat.search(/\.\s|\.$/);
  const cut = stop > 0 && stop < limit ? stop + 1 : Math.min(flat.length, limit);
  return flat.slice(0, cut) + (cut < flat.length ? "..." : "");
}

/*
 * What the HTTP status means, when the call never got as far as a picture.
 * These are the ones a key pasted into a browser actually meets.
 */
const HTTP_REASONS = {
  400: {
    what: "Bedrock rejected the request itself.",
    tryThis: [
      "The note from AWS below usually names what it didn't like — most often a prompt that is too long.",
      "Shorten the prompt in the review modal and try again.",
    ],
  },
  401: {
    what: "Bedrock wouldn't accept the API key.",
    tryThis: [
      "Paste the key again — a truncated paste lands here.",
      "A short-term key lasts twelve hours; a long-term key lasts until the date you gave it.",
    ],
  },
  403: {
    what: "Bedrock wouldn't accept the API key, or the key isn't allowed to use this model.",
    tryThis: [
      "Make sure it is a Bedrock API key — made under Amazon Bedrock → API keys in the AWS console — and not an IAM access key.",
      "Check the key hasn't expired, and that your AWS account can use Stability AI models in us-west-2.",
    ],
  },
  404: {
    what: "Bedrock has no model by that name in us-west-2.",
    tryThis: [
      "Pick another Bedrock model in the picker — models get retired without notice.",
    ],
  },
  424: {
    what: "The model itself failed while drawing.",
    tryThis: ["Try again in a minute. Nothing in your story was changed."],
  },
  429: {
    what: "Bedrock is asking you to slow down: too many pictures too quickly.",
    tryThis: ["Wait a minute and try again."],
  },
  500: {
    what: "Something broke at AWS's end.",
    tryThis: ["Try again in a minute. Nothing in your story was changed."],
  },
  503: {
    what: "Bedrock is overloaded right now.",
    tryThis: ["Try again in a minute, or try the Core model, which has the most room."],
  },
};

/**
 * Throw for a response that never got as far as a picture.
 *
 * AWS puts the error class in a header and a sentence in the body, under
 * `message` or `Message` depending on which layer refused. The sentence goes
 * on the banner; the rest is a click away.
 *
 * @param {Response} res
 * @param {string} model
 */
async function throwForStatus(res, model) {
  const body = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    // Some failures come back as HTML from a proxy rather than AWS's JSON.
  }
  const awsSaid = (parsed?.message ?? parsed?.Message ?? "").trim() || null;
  // "ValidationException:http://internal.amazon.com/coral/..." → the first word.
  const errorType =
    res.headers.get("x-amzn-ErrorType")?.split(":")[0]?.trim() || null;
  const reason = HTTP_REASONS[res.status] ?? null;

  const facts = [
    { label: "Model", value: model },
    { label: "Region", value: REGION },
    {
      label: "HTTP status",
      value: `${res.status}${res.statusText ? ` ${res.statusText}` : ""}`,
    },
  ];
  if (errorType) facts.push({ label: "AWS's code", value: errorType });
  if (awsSaid) facts.push({ label: "AWS's note", value: awsSaid });

  throw new BedrockError(
    `Bedrock couldn't draw the picture: ${
      awsSaid ? firstSentence(awsSaid) : `HTTP ${res.status}`
    }`,
    {
      title: "Bedrock turned the request down",
      what:
        reason?.what ??
        "The request reached AWS and came back as an error rather than a picture.",
      facts,
      saidInstead: null,
      tryThis: reason?.tryThis ?? [
        "Try again — nothing in your story was changed.",
      ],
      raw: rawReply(parsed ?? body),
    }
  );
}

/*
 * What the content filter says when it steps in. The reply still has the
 * shape of a success — it is `finish_reasons` that carries the news, as a
 * sentence rather than a code, and the picture that comes with it is not
 * one to put on the page.
 */
function filteredError(data, model, finishReason) {
  const onOutput = /output/i.test(finishReason);
  return new BedrockError(
    onOutput
      ? "Bedrock drew something and then its filter held the picture back."
      : "Bedrock wouldn't draw this one — its filter stopped the prompt.",
    {
      title: "No picture came back",
      what: onOutput
        ? "Stability's filter judged the finished picture, not the words, and kept it. The reply names the filter below."
        : "Stability's filter read the prompt as something it will not draw, before anything was drawn.",
      facts: [
        { label: "Model", value: model },
        { label: "Finish reason", value: finishReason },
      ],
      saidInstead: null,
      tryThis: [
        "Reword the caption. One word that reads as grown-up or violent out of context is usually the whole cause.",
        "Try another model in the picker — the filters don't all agree.",
      ],
      raw: rawReply(data),
    }
  );
}

/**
 * Have a Stability model on Bedrock draw a picture from words alone.
 * Returns a base64 PNG data URL.
 *
 * @param {string} apiKey – a Bedrock API key (long- or short-term)
 * @param {string} prompt
 * @param {string} [model] – one of IMAGE_MODELS; defaults to the first
 * @returns {Promise<string>} data URL
 */
export async function generateImage(apiKey, prompt, model) {
  const useModel = model || IMAGE_MODELS[0].id;
  // The model id goes in the path as written, colon and all, as AWS's own
  // examples have it; it is one of our constants, never user input.
  const url = `https://bedrock-runtime.${REGION}.amazonaws.com/model/${useModel}/invoke`;

  const body = {
    prompt,
    negative_prompt: NEGATIVE_PROMPT,
    mode: "text-to-image",
    aspect_ratio: "1:1",
    output_format: "png",
  };

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // fetch itself failed: no network, or the browser refused to send it.
    throw new BedrockError("Couldn't reach Bedrock.", {
      title: "The request never arrived",
      what: "The browser could not make the connection to AWS at all, so Bedrock never saw the request.",
      facts: [
        { label: "Model", value: useModel },
        { label: "Region", value: REGION },
        { label: "Browser said", value: err?.message ?? String(err) },
      ],
      saidInstead: null,
      tryThis: [
        "Check the connection and try again.",
        "An ad blocker or a strict network can refuse amazonaws.com; try another network.",
      ],
      raw: null,
    });
  }

  if (!res.ok) await throwForStatus(res, useModel);

  const data = await res.json();
  const finishReason = data?.finish_reasons?.[0] ?? null;
  if (finishReason) throw filteredError(data, useModel, finishReason);

  const b64 = data?.images?.[0];
  if (!b64) {
    throw new BedrockError("Bedrock sent a reply with no picture in it.", {
      title: "No picture came back",
      what: "Bedrock answered normally and the answer had no picture in it. That is unusual enough that the whole reply is below.",
      facts: [{ label: "Model", value: useModel }],
      saidInstead: null,
      tryThis: ["Try again — nothing in your story was changed."],
      raw: rawReply(data),
    });
  }
  return `data:image/png;base64,${b64}`;
}
