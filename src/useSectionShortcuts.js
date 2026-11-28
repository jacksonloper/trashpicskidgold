import { useEffect, useRef } from "react";
import {
  letterShortcutAvailable,
  overlayOpen,
  shortcutsAvailable,
} from "./keyboardScope";

/*
 * Held-key repeat.
 *
 * The browser's own key repeat is a fixed rate, which is fine for a handful of
 * pages and useless for seventy. This drives its own repeat instead and speeds
 * it up the longer the key is down: a tap moves one page, a moment's hold
 * walks, a long hold scrubs.
 */
const HOLD_BEFORE_REPEAT = 400; // ms a key must be down before it repeats
const FIRST_GAP = 180; // ms between the first repeats
const FASTEST_GAP = 45; // ms it accelerates to
const ACCELERATION = 0.82; // each repeat shortens the gap by this much

/**
 * The key that hands the keyboard to the section list.
 *
 * Backslash is unshifted, nowhere near the arrows, and means nothing else in
 * the app — so it is free to be the one stop between wherever you are and the
 * list, the way Tab used to be. It stays out of the way while you are typing,
 * where a backslash is just a backslash, and while a dialog is open.
 */
function isFocusListKey(event) {
  return (
    event.key === "\\" &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey &&
    shortcutsAvailable(event)
  );
}

/**
 * Put the keyboard on the selected row, so ↑/↓ turn pages from here.
 *
 * The row is found in the DOM rather than through a ref because the list owns
 * its own focus management; this only has to point at the row it already
 * marks as current.
 */
function focusSectionList() {
  const row =
    document.querySelector(".section-index-row.is-active") ??
    document.querySelector(".section-index-row");
  if (!row) return false;
  row.focus();
  row.scrollIntoView({ block: "nearest" });
  return true;
}

/**
 * Which way a key event moves, or null when it isn't ours.
 *
 * Alt+↑/↓ works anywhere, including mid-caption, so you never have to leave
 * the text box to change pages. The bare keys work wherever focus is, as long
 * as nothing is being typed and no dialog is open (see keyboardScope) — the
 * price is that the arrows no longer scroll the page, which the page turns
 * themselves already do.
 *
 * Alt+←/→ is deliberately not bound: that is Back and Forward in the browser.
 */
function directionFor(event) {
  const plainAlt = event.altKey && !event.ctrlKey && !event.metaKey;
  if (plainAlt) {
    if (overlayOpen()) return null;
    if (event.key === "ArrowUp") return "prev";
    if (event.key === "ArrowDown") return "next";
    return null;
  }

  if (
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.shiftKey ||
    !shortcutsAvailable(event)
  ) {
    return null;
  }

  switch (event.key) {
    case "ArrowUp":
    case "ArrowLeft":
      return "prev";
    case "ArrowDown":
    case "ArrowRight":
      return "next";
    // While the waiting game is up, letters are guesses, not page turns.
    case "k":
      return letterShortcutAvailable(event) ? "prev" : null;
    case "j":
      return letterShortcutAvailable(event) ? "next" : null;
    case "Home":
      return "first";
    case "End":
      return "last";
    default:
      return null;
  }
}

/**
 * Keyboard navigation between story sections.
 *
 * `onNavigate` is called with "prev" | "next" | "first" | "last". It is read
 * from a ref because it changes every time the selection moves: re-subscribing
 * mid-hold would cancel the repeat timer that makes holding work.
 */
export default function useSectionShortcuts(enabled, onNavigate) {
  const navigateRef = useRef(onNavigate);
  useEffect(() => {
    navigateRef.current = onNavigate;
  });

  useEffect(() => {
    if (!enabled) return undefined;

    let timer = null;
    let gap = FIRST_GAP;
    let held = null;

    const stop = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      gap = FIRST_GAP;
      held = null;
    };

    const repeat = () => {
      navigateRef.current(held);
      gap = Math.max(FASTEST_GAP, gap * ACCELERATION);
      timer = setTimeout(repeat, gap);
    };

    const handleKeyDown = (event) => {
      if (isFocusListKey(event)) {
        // Only swallow the key if there was a list to jump to.
        if (focusSectionList()) event.preventDefault();
        return;
      }

      const direction = directionFor(event);
      if (!direction) return;

      event.preventDefault();
      // The OS repeat is ignored — the timer below sets the pace instead.
      if (event.repeat) return;

      stop();
      navigateRef.current(direction);
      if (direction === "prev" || direction === "next") {
        held = direction;
        timer = setTimeout(repeat, HOLD_BEFORE_REPEAT);
      }
    };

    // Any key coming up ends the hold, as does losing the window: a repeat
    // that outlived the keypress would run away.
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", stop);
    window.addEventListener("blur", stop);

    return () => {
      stop();
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", stop);
      window.removeEventListener("blur", stop);
    };
  }, [enabled]);
}
