/*
 * The bits every waiting game shares: its colours, the burst a found target
 * goes out in, and the test for whether the keyboard is the grown-up's.
 */

export const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export const COLORS = [
  "#e5397c",
  "#f2760c",
  "#e0a800",
  "#2fa84f",
  "#1f8fe0",
  "#8b5cf6",
];

/** How long a target takes to vanish, and how long until the next one. */
export const POOF_MS = 420;
const SPARKS = 12;

export function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/** The burst a target goes out in. */
export function drawSparks() {
  return Array.from({ length: SPARKS }, (unused, i) => {
    const angle = (Math.PI * 2 * i) / SPARKS + Math.random() * 0.5;
    const distance = 70 + Math.random() * 80;
    return {
      dx: `${Math.round(Math.cos(angle) * distance)}px`,
      dy: `${Math.round(Math.sin(angle) * distance)}px`,
      color: pick(COLORS),
    };
  });
}

/** Somewhere a letter key means a letter, not a guess. */
export function isTyping(el) {
  if (!el) return false;
  return (
    el.isContentEditable ||
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT"
  );
}
