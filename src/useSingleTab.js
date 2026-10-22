import { useEffect, useState } from "react";

/**
 * One tab at a time.
 *
 * Two tabs of the app share one IndexedDB but not one idea of what is in
 * it: each holds its own copy of the open story, the later autosave wins,
 * and with Drive sync on, both would sync the same stories on their own
 * timers. Rather than coordinate all that, only one tab gets to be the app.
 *
 * The first tab takes a browser-wide lock and keeps it until it closes. A
 * second tab finds the lock taken and is told so instead of being given the
 * app; its "Use this tab instead" steals the lock, at which point the first
 * tab's request is aborted and it becomes the one standing aside. Nothing
 * is lost either way: a tab standing aside has unmounted the app, whose
 * cleanup flushes any pending save first.
 *
 * Returns "checking" | "active" | "blocked", and a takeOver() for the button.
 * Browsers without the Web Locks API (none current) are simply let through.
 */

const LOCK_NAME = "storymaker-active-tab";

export default function useSingleTab() {
  const [status, setStatus] = useState(() =>
    navigator.locks ? "checking" : "active"
  );
  const [attempt, setAttempt] = useState(0); // bumped by takeOver

  useEffect(() => {
    if (!navigator.locks) return;
    let cancelled = false;
    let released = () => {};
    const held = new Promise((resolve) => {
      released = resolve;
    });
    const steal = attempt > 0;

    const ask = () =>
      navigator.locks.request(LOCK_NAME, { ifAvailable: !steal, steal }, (lock) => {
        if (!lock) return false;
        if (cancelled) return true; // granted after unmount: let it go at once
        setStatus("active");
        // Hold it for as long as this tab is the app.
        return held.then(() => true);
      });

    (async () => {
      try {
        if (await ask()) return;
        // Not available. A lock this tab itself just let go of (React's
        // development-mode remount) is still being released at this
        // instant, so look once more before calling it someone else's.
        await new Promise((r) => setTimeout(r, 300));
        if (cancelled) return;
        if (await ask()) return;
        if (!cancelled) setStatus("blocked");
      } catch (err) {
        // AbortError: another tab stole the lock out from under us.
        if (err?.name === "AbortError" && !cancelled) setStatus("blocked");
      }
    })();

    return () => {
      cancelled = true;
      released();
    };
  }, [attempt]);

  return {
    status,
    takeOver: () => setAttempt((n) => n + 1),
  };
}
