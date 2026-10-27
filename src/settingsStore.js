/*
 * The few things a grown-up can change about the app, kept in localStorage so
 * they survive a reload. Nothing here is a story: losing it costs a click.
 */

const STORAGE_KEY = "storymaker_settings";

/** The games the waiting letter can play. */
export const WAITING_GAMES = [
  {
    id: "letter",
    label: "Find the letter",
    description: "A letter appears. Find it on the keyboard.",
  },
  {
    id: "picture",
    label: "First letter of the picture",
    description:
      "A picture appears — a dog, a cat, an apple. Type the letter its name starts with.",
  },
  {
    id: "last",
    label: "Last letter of the picture",
    description:
      "A picture appears — a cat, a drum, a bus — and a caterpillar underneath spells its name, all but the last letter. Type the letter that fills it in. Every name ends on a letter you can hear: no silent E, no dough.",
  },
];

export const DEFAULT_SETTINGS = Object.freeze({
  waitingGame: "letter",
  // P reads in Gemini's voice (fetched with the API key) rather than the
  // browser's own.
  geminiVoice: true,
});

function isWaitingGame(id) {
  return WAITING_GAMES.some((g) => g.id === id);
}

/** Whatever was saved, on top of the defaults, with anything unknown dropped. */
export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const saved = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      waitingGame: isWaitingGame(saved?.waitingGame)
        ? saved.waitingGame
        : DEFAULT_SETTINGS.waitingGame,
      geminiVoice:
        typeof saved?.geminiVoice === "boolean"
          ? saved.geminiVoice
          : DEFAULT_SETTINGS.geminiVoice,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* localStorage unavailable – the setting still holds until reload */
  }
}

/** Forget the settings, for a computer the family is leaving. */
export function clearSettings() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* localStorage unavailable */
  }
}
