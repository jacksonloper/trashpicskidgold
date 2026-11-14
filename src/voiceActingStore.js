import { SPEECH_DIRECTION, SPEECH_VOICE } from "./gemini";

/*
 * How a story is voice-acted: which of Gemini's voices reads it, and the
 * direction it is given before the words.
 *
 * Like the readings themselves, this is not part of the story. It lives in
 * localStorage on this computer, keyed by story — never in the story record,
 * so it is never exported in a ZIP or backed up to Drive. Forgetting the
 * computer sweeps it with everything else under the app's prefix.
 */

const PREFIX = "storymaker_voice_acting_";

export const DEFAULT_VOICE_ACTING = Object.freeze({
  voice: SPEECH_VOICE,
  direction: SPEECH_DIRECTION,
});

export function loadVoiceActing(storyId) {
  if (!storyId) return { ...DEFAULT_VOICE_ACTING };
  try {
    const saved = JSON.parse(localStorage.getItem(PREFIX + storyId) ?? "null");
    return {
      voice:
        typeof saved?.voice === "string" && saved.voice
          ? saved.voice
          : DEFAULT_VOICE_ACTING.voice,
      direction:
        typeof saved?.direction === "string"
          ? saved.direction
          : DEFAULT_VOICE_ACTING.direction,
    };
  } catch {
    return { ...DEFAULT_VOICE_ACTING };
  }
}

export function saveVoiceActing(storyId, acting) {
  if (!storyId) return;
  try {
    localStorage.setItem(PREFIX + storyId, JSON.stringify(acting));
  } catch {
    /* localStorage unavailable – holds until reload */
  }
}

