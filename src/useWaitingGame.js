import { useCallback, useEffect, useRef, useState } from "react";

/*
 * When the waiting letter is on screen.
 *
 * All of it is timing, and the timing is why this is a hook rather than three
 * lines in the component:
 *
 * - A wait has to last a moment before a letter is worth putting up. A
 *   generation that fails in 200 ms should not flash one at the player.
 * - "Generate Illustration" is two waits back to back — plan, then image — with
 *   a render in between where nothing is running. Ending the game there and
 *   starting it again a frame later would be a horrible blink, so a gap has to
 *   stay quiet for a moment before it counts as the end.
 * - The end is not instant either: the last letter poofs on its way out, and
 *   the component says when it is done by calling `close`.
 */

const OPEN_DELAY = 600; // ms a wait must last before a letter appears
const END_GRACE = 700; // ms of quiet before a wait counts as finished

/**
 * @param active    true while something is being generated
 * @param suspended true while a dialog owns the screen
 */
export default function useWaitingGame({ active, suspended }) {
  const [phase, setPhase] = useState(null); // null | "playing" | "leaving"
  const [hidden, setHidden] = useState(false);

  const latest = useRef({ phase, hidden });
  useEffect(() => {
    latest.current = { phase, hidden };
  });

  useEffect(() => {
    if (active) {
      const timer = setTimeout(() => setPhase("playing"), OPEN_DELAY);
      return () => clearTimeout(timer);
    }

    const timer = setTimeout(() => {
      const { phase: now, hidden: away } = latest.current;
      if (!now || now === "leaving") return;
      // Nobody is watching a letter that was waved away, so there is nothing
      // to say goodbye to.
      if (away) {
        setPhase(null);
        setHidden(false);
        return;
      }
      setPhase("leaving");
    }, END_GRACE);
    return () => clearTimeout(timer);
  }, [active]);

  const close = useCallback(() => {
    setPhase(null);
    setHidden(false);
  }, []);

  return {
    /** Whether a letter belongs on screen at all. */
    on: !!phase,
    /** …and whether it is showing right now, or standing aside for a dialog. */
    visible: !!phase && !hidden && !suspended,
    /** The picture has landed: poof the last letter and call `close`. */
    leaving: phase === "leaving",
    hide: useCallback(() => setHidden(true), []),
    close,
  };
}
