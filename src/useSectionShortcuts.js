import { useEffect, useRef } from "react";

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

/** Somewhere the arrow keys already mean something to the user. */
function isTypingTarget(el) {
  if (!el) return false;
  return (
    el.isContentEditable ||
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT"
  );
}

/**
 * Which way a key event moves, or null when it isn't ours.
 *
 * Alt+↑/↓ works anywhere, including mid-caption, so you never have to leave
 * the text box to change pages. The bare keys only apply once focus is on the
 * section list itself — otherwise they would steal the arrow keys from
 * scrolling the page, and ← → from the caption you are editing.
 *
 * Alt+←/→ is deliberately not bound: that is Back and Forward in the browser.
 */
function directionFor(event, listHasFocus) {
  const plainAlt = event.altKey && !event.ctrlKey && !event.metaKey;
  if (plainAlt) {
    if (event.key === "ArrowUp") return "prev";
    if (event.key === "ArrowDown") return "next";
    return null;
  }

  if (
    !listHasFocus ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.shiftKey ||
    isTypingTarget(event.target)
  ) {
    return null;
  }

  switch (event.key) {
    case "ArrowUp":
    case "ArrowLeft":
    case "k":
      return "prev";
    case "ArrowDown":
    case "ArrowRight":
    case "j":
      return "next";
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
      const listHasFocus =
        document.activeElement?.classList.contains("section-index-row");
      const direction = directionFor(event, listHasFocus);
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
