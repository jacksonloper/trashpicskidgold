import { useEffect, useRef } from "react";
import { getSpeech, putSpeech } from "./db";
import { sha256Hex } from "./driveBackup/hashing";
import { generateSpeech, SPEECH_DIRECTION, SPEECH_VOICE } from "./gemini";

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

/** The one key that reads the page: a bare P, nowhere near a text box. */
function isReadKey(event) {
  const el = event.target;
  const typing =
    el &&
    (el.isContentEditable ||
      el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.tagName === "SELECT");
  return (
    (event.key === "p" || event.key === "P") &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !typing
  );
}

/* ---- Gemini's voice ---- */

/** How long P waits for Gemini before the browser's own voice reads instead. */
const GEMINI_WAIT_MS = 5000;

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

/** The cache key: the words, and everything that decides how they sound. */
function speechKey(text) {
  return sha256Hex(`${SPEECH_VOICE}\n${SPEECH_DIRECTION}\n${text}`);
}

/**
 * Gemini's reading of `text`: from the cache if it has been read before,
 * otherwise fetched and kept. The cache stays on this computer — it is not
 * backed up or exported, since any of it can be made again.
 */
function getReading(apiKey, text) {
  return (async () => {
    const key = await speechKey(text);
    const kept = await getSpeech(key).catch(() => null);
    if (kept) {
      putSpeech({ ...kept, usedAt: Date.now() }).catch(() => {});
      return kept;
    }
    if (!inFlight.has(key)) {
      const fetching = generateSpeech(apiKey, text)
        .then(async ({ pcm, sampleRate }) => {
          const record = { key, pcm, sampleRate, usedAt: Date.now() };
          await putSpeech(record).catch((e) =>
            console.warn("Couldn't keep the reading", e)
          );
          return record;
        })
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
 * Read `text` in Gemini's voice when it can, the browser's when it can't.
 *
 * A page read before plays at once from the cache. A new one waits a few
 * seconds for Gemini; past that, or on any failure, the browser reads it
 * instead, and Gemini's reading — if it still arrives — is kept for next time.
 */
function readAloud(text, apiKey) {
  stopReading();
  const mine = generation;
  if (!geminiAvailable(apiKey)) {
    speakWithBrowser(text);
    return;
  }
  let settled = false;
  const fallBack = () => {
    if (settled || mine !== generation) return;
    settled = true;
    speakWithBrowser(text);
  };
  const timer = setTimeout(fallBack, GEMINI_WAIT_MS);
  getReading(apiKey, text).then(
    (reading) => {
      clearTimeout(timer);
      if (settled || mine !== generation) return;
      settled = true;
      playReading(reading);
    },
    (e) => {
      clearTimeout(timer);
      console.warn("Gemini couldn't read the page; the browser will", e);
      fallBack();
    }
  );
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
 * fetched ahead, so P usually plays it without a wait.
 *
 * Turning the page cuts the speech short — a caption still being read over a
 * different picture would be confusing — as does leaving the story.
 */
export default function useReadAloud(enabled, section, apiKey) {
  const sectionRef = useRef(section);
  const apiKeyRef = useRef(apiKey);
  useEffect(() => {
    sectionRef.current = section;
    apiKeyRef.current = apiKey;
  });

  // The page under the voice has changed: whatever it was saying is about the
  // last page, so stop it. (This also runs on the way out.)
  const sectionId = section?.id ?? null;
  useEffect(() => stopReading, [sectionId]);

  // Fetch the reading of a page that has settled on screen, so P needn't wait.
  // Holding an arrow down flies past pages without asking for any of them.
  const text = spokenText(section);
  useEffect(() => {
    if (!enabled || !text || !apiKey?.trim()) return undefined;
    const timer = setTimeout(() => {
      if (Date.now() < geminiQuietUntil) return;
      getReading(apiKey, text).catch(() => {});
    }, PREFETCH_AFTER_MS);
    return () => clearTimeout(timer);
  }, [enabled, text, apiKey]);

  useEffect(() => {
    if (!enabled) return undefined;

    const handleKeyDown = (event) => {
      const listHasFocus =
        document.activeElement?.classList.contains("section-index-row");
      if (!listHasFocus || !isReadKey(event)) return;
      event.preventDefault();
      if (event.repeat) return;

      const words = spokenText(sectionRef.current);
      // A second P starts over from the top rather than talking over itself.
      if (words) readAloud(words, apiKeyRef.current);
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
