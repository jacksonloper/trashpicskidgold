import { useCallback, useEffect, useRef, useState } from "react";

/*
 * When the waiting game is on screen, and what it should say when the wait is
 * over.
 *
 * All of it is timing, and the timing is why this is a hook rather than three
 * lines in the component:
 *
 * - A wait has to last a moment before the game is worth showing. A generation
 *   that fails in 200 ms should not flash a game at the player.
 * - "Generate Illustration" is two waits back to back — plan, then image — with
 *   a render in between where nothing is running. Ending the game there and
 *   starting it again a frame later would be a horrible blink, so a gap has to
 *   stay quiet for a moment before it counts as the end.
 * - What the ending says depends on what actually happened: a new picture, a
 *   failure, or a plan waiting for approval — and that last one wants the
 *   screen back immediately, so the game just closes.
 */

const OPEN_DELAY = 600; // ms a wait must last before the game appears
const END_GRACE = 700; // ms of quiet before a wait counts as finished
const AUTO_OPEN_KEY = "storymaker_waiting_game_auto";

function readAutoOpen() {
  try {
    return localStorage.getItem(AUTO_OPEN_KEY) !== "off";
  } catch {
    return true; // localStorage unavailable — the game is the default
  }
}

function writeAutoOpen(on) {
  try {
    localStorage.setItem(AUTO_OPEN_KEY, on ? "on" : "off");
  } catch {
    /* localStorage unavailable – the choice just won't outlive the tab */
  }
}

/**
 * @param job       {kind, label} while something is being generated, else null
 * @param suspended true while a dialog owns the screen
 * @param error     the app's error banner text, whatever it currently says
 * @param planOpen  true when a finished plan is waiting for approval
 */
export default function useWaitingGame({ job, suspended, error, planOpen }) {
  const active = !!job;
  // What the wait is called. A primitive, so a story keystroke that rebuilds
  // the job object doesn't restart the timers below.
  const jobKey = job ? `${job.kind} ${job.label ?? ""}` : "";

  const [session, setSession] = useState(null); // {kind,label,phase,outcome,doneAt}
  const [hidden, setHidden] = useState(false);
  const [autoOpen, setAutoOpenState] = useState(readAutoOpen);

  // Read when a wait ends rather than when the effect subscribed, so the
  // ending is decided by what the app looks like at that moment.
  const latest = useRef({ job, error, planOpen, autoOpen, session, hidden });
  useEffect(() => {
    latest.current = { job, error, planOpen, autoOpen, session, hidden };
  });

  // The error on screen when this wait started: an older one still sitting
  // there does not mean this generation failed.
  const errorAtStart = useRef(null);

  useEffect(() => {
    if (active) {
      const timer = setTimeout(() => {
        const { job: current, session: prev, autoOpen: auto } = latest.current;
        if (!prev) {
          errorAtStart.current = latest.current.error;
          setHidden(!auto);
        }
        setSession({
          kind: current?.kind ?? prev?.kind ?? "illustration",
          label: current?.label ?? prev?.label ?? null,
          phase: "playing",
          outcome: null,
          doneAt: 0,
        });
      }, OPEN_DELAY);
      return () => clearTimeout(timer);
    }

    const timer = setTimeout(() => {
      const { session: prev, error: now, planOpen: plan } = latest.current;
      if (!prev || prev.phase === "done") return;
      if (plan || latest.current.hidden) {
        // Nobody is looking: either a prompt is waiting to be read and
        // approved — which is the screen's job now, and no picture to
        // celebrate yet — or the game was put away and the grown-up is
        // working, in which case the picture arriving on the page is the only
        // announcement wanted. Either way the wait is simply over.
        setSession(null);
        setHidden(false);
        return;
      }
      setSession({
        ...prev,
        phase: "done",
        outcome: now && now !== errorAtStart.current ? "error" : "art",
        doneAt: Date.now(),
      });
    }, END_GRACE);
    return () => clearTimeout(timer);
  }, [active, jobKey]);

  const close = useCallback(() => {
    setSession(null);
    setHidden(false);
  }, []);

  const setAutoOpen = useCallback((on) => {
    setAutoOpenState(on);
    writeAutoOpen(on);
    if (on) setHidden(false);
  }, []);

  return {
    session,
    /** The overlay is on screen: playing, or showing how the wait ended. */
    visible: !!session && !hidden && !suspended,
    /** The little "play while you wait" button, offered instead. */
    chip: !!session && hidden && !suspended,
    open: useCallback(() => setHidden(false), []),
    hide: useCallback(() => setHidden(true), []),
    close,
    autoOpen,
    setAutoOpen,
  };
}
