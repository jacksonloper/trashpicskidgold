import { useCallback, useEffect, useRef, useState } from "react";
import { createPaintCatcher } from "../paintCatcher";

/*
 * The overlay that goes up while a picture is being made.
 *
 * Every generation is thirty to ninety seconds of a progress-free "Generating…"
 * button, which is a very long time to a five-year-old. This puts a game over
 * the page for exactly as long as the wait lasts, and gets out of the way the
 * moment the picture lands.
 *
 * It is not a modal: generation carries on underneath it, **Hide game** puts it
 * away without stopping anything, and the checkbox at the bottom stops it
 * opening by itself for grown-ups who would rather keep working.
 */

/** How long the "your picture is ready" card waits before bowing out. */
const DONE_COUNTDOWN = 7; // seconds

const CHEERS = [
  "Nice catch!",
  "Splat!",
  "Lovely colour!",
  "Keep going!",
  "Ooh, pretty!",
];

const STEER_KEYS = ["ArrowLeft", "ArrowRight", "a", "A", "d", "D"];

/** What the top of the overlay says about the wait it is covering. */
function statusLine(kind, label) {
  if (kind === "planning") {
    return label ? `Thinking up ${label}…` : "Thinking up your picture…";
  }
  if (kind === "reference") {
    return label ? `Drawing ${label}…` : "Drawing your reference art…";
  }
  return label ? `Painting ${label}…` : "Painting your picture…";
}

export default function WaitingGame({
  kind,
  label,
  phase,
  outcome,
  doneAt,
  visible,
  autoOpen,
  onAutoOpenChange,
  onHide,
  onClose,
}) {
  const canvasRef = useRef(null);
  const gameRef = useRef(null);
  const cheerTimer = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  const [score, setScore] = useState(0);
  const [cheer, setCheer] = useState(null);
  // The ending the player waved away, stamped with the moment that wait
  // finished — so the next wait's ending gets its own card rather than
  // inheriting this one's dismissal.
  const [keptFor, setKeptFor] = useState(0);
  const [left, setLeft] = useState(DONE_COUNTDOWN);

  const done = phase === "done";
  const card = done && keptFor !== doneAt;

  /* ---- the game itself ---- */

  useEffect(() => {
    const game = createPaintCatcher(canvasRef.current, {
      onEvent: (e) => {
        if (e.type !== "catch") return;
        setScore(e.score);

        let message = null;
        if (e.kind === "star") message = "⭐ Star! Five points!";
        else if (e.combo === 5) message = "Five in a row!";
        else if (e.combo === 10) message = "Ten in a row! Wow!";
        else if (e.combo > 0 && e.combo % 25 === 0) message = `${e.combo} in a row!!`;
        else if (Math.random() < 0.12)
          message = CHEERS[Math.floor(Math.random() * CHEERS.length)];
        if (!message) return;

        setCheer(message);
        clearTimeout(cheerTimer.current);
        cheerTimer.current = setTimeout(() => setCheer(null), 1600);
      },
    });
    gameRef.current = game;
    return () => {
      clearTimeout(cheerTimer.current);
      game.destroy();
      gameRef.current = null;
    };
  }, []);

  /*
   * Running only while it is on screen, in a tab someone is looking at, and
   * not behind the card that says the wait is over. Paused, it keeps every
   * splat already on the paper — hiding the game is not losing the painting.
   */
  useEffect(() => {
    const game = gameRef.current;
    if (!game) return undefined;

    const sync = () => {
      if (visible && !card && !document.hidden) game.resume();
      else game.pause();
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      game.pause();
    };
  }, [visible, card]);

  /* ---- steering ---- */

  useEffect(() => {
    if (!visible) return undefined;

    const down = (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "Escape") {
        e.preventDefault();
        if (done) closeRef.current();
        else onHide();
        return;
      }
      const dir =
        e.key === "ArrowLeft" || e.key === "a" || e.key === "A"
          ? -1
          : e.key === "ArrowRight" || e.key === "d" || e.key === "D"
            ? 1
            : 0;
      if (!dir) return;
      e.preventDefault();
      gameRef.current?.setSteer(dir);
    };

    const up = (e) => {
      if (STEER_KEYS.includes(e.key)) gameRef.current?.setSteer(0);
    };
    const release = () => gameRef.current?.setSteer(0);

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", release);
    return () => {
      release();
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", release);
    };
  }, [done, onHide, visible]);

  const handlePointer = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    gameRef.current?.setPointer(e.clientX - rect.left);
  }, []);

  const handlePointerLeave = useCallback(() => {
    gameRef.current?.clearPointer();
  }, []);

  /* ---- bowing out ---- */

  /*
   * Counted from when the card actually came on screen, not from when the
   * wait ended: a dialog can hold the card back for a while, and a card that
   * appears with two seconds left on it — or none — reads as a glitch.
   */
  useEffect(() => {
    if (!card || !visible) return undefined;
    const shownAt = Date.now();
    const tick = () => {
      const remaining = DONE_COUNTDOWN - Math.round((Date.now() - shownAt) / 1000);
      if (remaining <= 0) {
        clearInterval(timer);
        closeRef.current();
        return;
      }
      setLeft(remaining);
    };
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 250);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [card, doneAt, visible]);

  const failed = outcome === "error";

  return (
    <div
      className={`waiting-game${visible ? "" : " is-away"}`}
      role="dialog"
      aria-label="Something to play while your picture is made"
      aria-hidden={!visible}
    >
      <div className="waiting-game-panel">
        <div className="waiting-game-bar">
          <span className="waiting-game-status">
            {done ? (
              failed ? (
                "That one didn't work"
              ) : (
                "Finished!"
              )
            ) : (
              <>
                {statusLine(kind, label)}
                <span className="waiting-game-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              </>
            )}
          </span>
          <span className="waiting-game-score">
            {cheer && <em className="waiting-game-cheer">{cheer}</em>}
            <strong>🎨 {score}</strong>
          </span>
        </div>

        <div
          className="waiting-game-stage"
          onPointerMove={handlePointer}
          onPointerDown={handlePointer}
          onPointerLeave={handlePointerLeave}
        >
          <canvas ref={canvasRef} className="waiting-game-canvas" />

          {card && (
            <div className="waiting-game-card">
              <h2>
                {failed ? "😕 No picture this time" : "✨ Your picture is ready!"}
              </h2>
              <p>
                {failed
                  ? "There is a message about it back on the page."
                  : `You caught ${score} ${
                      score === 1 ? "splat" : "splats"
                    } while it was being painted.`}
              </p>
              <div className="waiting-game-card-buttons">
                <button type="button" className="btn-primary" onClick={onClose}>
                  {failed ? "Back to the story" : "See my picture"} ({left})
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setKeptFor(doneAt)}
                >
                  Keep playing
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="waiting-game-foot">
          <span className="waiting-game-hint">
            Catch the paint! Drag it about, or steer with ← →. Every drop you
            catch lands on the paper.
          </span>
          <span className="waiting-game-foot-actions">
            <label className="waiting-game-auto">
              <input
                type="checkbox"
                checked={autoOpen}
                onChange={(e) => onAutoOpenChange(e.target.checked)}
              />
              Open by itself
            </label>
            <button
              type="button"
              className="btn-small"
              onClick={done ? onClose : onHide}
            >
              {done ? "Close" : "Hide game"}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
