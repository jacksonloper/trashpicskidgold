import { useEffect, useRef, useState } from "react";
import { getSpeech, putSpeech } from "./db";
import { sha256Hex } from "./driveBackup/hashing";
import { generateSpeech } from "./gemini";
import { DEFAULT_VOICE_ACTING } from "./voiceActingStore";
import { letterShortcutAvailable } from "./keyboardScope";

/**
 * What a page says out loud: its caption, or the words of a text block.
 *
 * Markdown is written to be read on a screen, not spoken, so the punctuation
 * that only means something to a renderer is dropped: heading hashes, list
 * bullets, emphasis stars, backticks, and the URL half of a link.
 */
export function spokenText(section) {
  if (!section) return "";
  const raw =
    section.type === "illustration"
      ? section.caption ?? ""
      : section.content ?? "";
  return raw
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // [words](url) → words
    .replace(/^\s{0,3}#{1,6}\s+/gm, "") // heading hashes
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "") // list bullets
    .replace(/^\s*>\s?/gm, "") // blockquote bars
    .replace(/[*_`~]+/g, "") // emphasis and code marks
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * The one key that reads the page: a bare P, from anywhere but a text box, an
 * open dialog, or the waiting game (where P is a guess).
 */
function isReadKey(event) {
  return (
    (event.key === "p" || event.key === "P") &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    letterShortcutAvailable(event)
  );
}

/* ---- Gemini's voice ---- */

/** A page has to stay on screen this long before its reading is fetched ahead. */
const PREFETCH_AFTER_MS = 1200;

/** After a failure, Gemini is left alone this long: the browser voice reads. */
const COOL_OFF_MS = 60_000;

let geminiQuietUntil = 0;

/** Readings on their way, by cache key, so a page is never asked for twice. */
const inFlight = new Map();

let audioContext = null;
let playing = null;

/**
 * Bumped by every P and every stop. A reading that arrives after its number
 * has moved on is for a page no longer on screen, and stays quiet.
 */
let generation = 0;

/**
 * The one audio context, woken from inside the keypress. Safari only lets a
 * page make sound in answer to a gesture; resuming here, before the wait
 * for Gemini, is what lets the reading play when it lands seconds later.
 */
function wakeAudio() {
  const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Ctx) return null;
  audioContext ??= new Ctx();
  if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
  return audioContext;
}

/** Told whenever a reading is kept, so a "make the voice" button can relabel. */
const keptListeners = new Set();

function announceKept(key) {
  for (const listener of keptListeners) listener(key);
}

/**
 * The cache key: the words, and everything that decides how they sound —
 * the voice and its direction. Changing either is a different reading.
 */
function speechKey(text, acting = DEFAULT_VOICE_ACTING) {
  return sha256Hex(`${acting.voice}\n${acting.direction}\n${text}`);
}

/** The reading of `text` already on this computer, or null. */
async function keptReading(text, acting) {
  const kept = await getSpeech(await speechKey(text, acting)).catch(() => null);
  if (kept) putSpeech({ ...kept, usedAt: Date.now() }).catch(() => {});
  return kept;
}

/** Fetch a reading from Gemini and keep it, replacing any kept already. */
async function fetchAndKeep(apiKey, text, acting, key) {
  const { pcm, sampleRate } = await generateSpeech(apiKey, text, acting);
  const record = { key, pcm, sampleRate, usedAt: Date.now() };
  await putSpeech(record).catch((e) =>
    console.warn("Couldn't keep the reading", e)
  );
  announceKept(key);
  return record;
}

/**
 * Gemini's reading of `text`: from the cache if it has been read before,
 * otherwise fetched and kept. The cache stays on this computer — it is not
 * backed up or exported, since any of it can be made again.
 */
function getReading(apiKey, text, acting) {
  return (async () => {
    const kept = await keptReading(text, acting);
    if (kept) return kept;
    const key = await speechKey(text, acting);
    if (!inFlight.has(key)) {
      const fetching = fetchAndKeep(apiKey, text, acting, key)
        .catch((e) => {
          geminiQuietUntil = Date.now() + COOL_OFF_MS;
          throw e;
        })
        .finally(() => inFlight.delete(key));
      inFlight.set(key, fetching);
    }
    return inFlight.get(key);
  })();
}

function geminiAvailable(apiKey) {
  return !!apiKey?.trim() && Date.now() >= geminiQuietUntil && !!wakeAudio();
}

function playReading({ pcm, sampleRate }) {
  const ctx = wakeAudio();
  const samples = new Int16Array(pcm, 0, Math.floor(pcm.byteLength / 2));
  const buffer = ctx.createBuffer(1, Math.max(samples.length, 1), sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 32768;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.onended = () => {
    if (playing === source) playing = null;
  };
  playing = source;
  source.start();
}

function speakWithBrowser(text) {
  const synth = globalThis.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === "undefined") return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = document.documentElement.lang || "en";
  synth.speak(utterance);
}

/** Stop whatever is being said, by either voice. */
export function stopReading() {
  generation += 1;
  globalThis.speechSynthesis?.cancel();
  if (playing) {
    try {
      playing.stop();
    } catch {
      // Already finished.
    }
    playing = null;
  }
}

/**
 * Read `text` in Gemini's voice if its reading is already here, the
 * browser's if not.
 *
 * A keypress never waits on the network: a page whose reading hasn't
 * downloaded yet is read by the browser straight away, and its reading is
 * fetched meanwhile so the next P plays it.
 */
function readAloud(text, apiKey, acting) {
  stopReading();
  const mine = generation;
  if (!geminiAvailable(apiKey)) {
    speakWithBrowser(text);
    return;
  }
  keptReading(text, acting).then((reading) => {
    if (mine !== generation) return;
    if (reading) {
      playReading(reading);
      return;
    }
    speakWithBrowser(text);
    getReading(apiKey, text, acting).catch((e) =>
      console.warn("Gemini couldn't read the page", e)
    );
  });
}

/**
 * Have Gemini voice-act a page afresh, keep it in place of whatever reading
 * it had, and play it. For when a take came out wrong, or the direction has
 * been rewritten and the page should be heard with it now.
 *
 * The keypress that asked for it wakes the audio, so it can play when the
 * reading lands seconds later — unless the page has been turned by then.
 */
export async function remakeReading(apiKey, section, acting) {
  const text = spokenText(section);
  if (!text) throw new Error("This page has no words to read.");
  wakeAudio();
  stopReading();
  const mine = generation;
  const key = await speechKey(text, acting);
  const reading = await fetchAndKeep(apiKey, text, acting, key);
  geminiQuietUntil = 0;
  if (mine === generation) playReading(reading);
}

/**
 * Whether `section` has a reading kept for `acting`: null while finding out.
 * Turns true the moment one is kept, whoever fetched it.
 */
export function useHasReading(section, acting) {
  const text = spokenText(section);
  const [state, setState] = useState({ for: null, has: false });
  const ask = `${acting.voice}\n${acting.direction}\n${text}`;
  useEffect(() => {
    if (!text) return undefined;
    let live = true;
    let key = null;
    speechKey(text, acting).then((k) => {
      key = k;
      return getSpeech(k)
        .catch(() => null)
        .then((kept) => live && setState({ for: ask, has: !!kept }));
    });
    const onKept = (k) => {
      if (live && k === key) setState({ for: ask, has: true });
    };
    keptListeners.add(onKept);
    return () => {
      live = false;
      keptListeners.delete(onKept);
    };
    // `ask` stands for text and acting together.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask]);
  if (!text) return false;
  return state.for === ask ? state.has : null;
}

/**
 * Read the selected page aloud on P while the story list has the keyboard.
 *
 * The kid can't read yet; this is how the page reads itself to them. A page
 * with nothing written on it says so rather than staying silent, because
 * silence after a keypress reads as "broken" to a four-year-old.
 *
 * With an API key the voice is Gemini's, which sounds like a person rather
 * than a machine. A page that sits on screen for a moment has its reading
 * fetched ahead; until it has arrived, the browser's voice reads instead.
 *
 * Turning the page cuts the speech short — a caption still being read over a
 * different picture would be confusing — as does leaving the story.
 */
export default function useReadAloud(
  enabled,
  section,
  apiKey,
  acting = DEFAULT_VOICE_ACTING
) {
  const sectionRef = useRef(section);
  const apiKeyRef = useRef(apiKey);
  const actingRef = useRef(acting);
  useEffect(() => {
    sectionRef.current = section;
    apiKeyRef.current = apiKey;
    actingRef.current = acting;
  });

  // The page under the voice has changed: whatever it was saying is about the
  // last page, so stop it. (This also runs on the way out.)
  const sectionId = section?.id ?? null;
  useEffect(() => stopReading, [sectionId]);

  // Fetch the reading of a page that has settled on screen, so P needn't wait.
  // Holding an arrow down flies past pages without asking for any of them.
  // A direction being typed waits for the typing to stop in the same way.
  const text = spokenText(section);
  const { voice, direction } = acting;
  useEffect(() => {
    if (!enabled || !text || !apiKey?.trim()) return undefined;
    const timer = setTimeout(() => {
      if (Date.now() < geminiQuietUntil) return;
      getReading(apiKey, text, { voice, direction }).catch(() => {});
    }, PREFETCH_AFTER_MS);
    return () => clearTimeout(timer);
  }, [enabled, text, apiKey, voice, direction]);

  useEffect(() => {
    if (!enabled) return undefined;

    const handleKeyDown = (event) => {
      if (!isReadKey(event)) return;
      event.preventDefault();
      if (event.repeat) return;

      const words = spokenText(sectionRef.current);
      // A second P starts over from the top rather than talking over itself.
      if (words) readAloud(words, apiKeyRef.current, actingRef.current);
      else {
        stopReading();
        speakWithBrowser("This page has no words yet.");
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      stopReading();
    };
  }, [enabled]);
}
