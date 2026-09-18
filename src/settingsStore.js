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
];

export const DEFAULT_SETTINGS = Object.freeze({
  waitingGame: "letter",
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
