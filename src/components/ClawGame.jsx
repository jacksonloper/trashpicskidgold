import { useCallback, useEffect, useRef, useState } from "react";
import {
  ALPHABET,
  COLORS,
  POOF_MS,
  drawSparks,
  isTyping,
  pick,
} from "../waitingFx";

/*
 * A claw machine full of letter balls, and one letter to fish out of it.
 *
 * The letter wanted is lit up on the sign at the top. ← and → slide the claw
 * along its rail, ↓ (or Space) drops it, and whatever ball is underneath comes
 * up with it. The right one goes off in a burst of colour and a new machine
 * full is dealt; a wrong one wobbles at the top and slips back into the pile.
 * Like the other waiting games, a wrong grab costs nothing.
 *
 * Typing a letter is a shortcut that keeps it a letter game: the claw slides
 * over to that ball by itself and grabs it, so the kid who can find B on the
 * keyboard but not yet steer still gets to watch it work. On a touch screen
 * the balls themselves are the buttons — tap one and the claw goes for it.
 *
 * The keyboard is borrowed the same way the letter game borrows it: nothing
 * happens with the caret in a text box, and the arrow keys are left alone
 * while the story list has them for turning pages.
 */

/** Balls in the machine: the one asked for and the rest to get in the way. */
const BALLS = 4;
/** How long the claw takes to slide over, drop, grip, and come back up. */
const MOVE_MS = 300;
const DROP_MS = 520;
const GRIP_MS = 200;
const LIFT_MS = 520;
/** How long a wrong ball wobbles at the top before it falls back. */
const WOBBLE_MS = 420;

let nextId = 1;

/** A machine full: the letter asked for, and every ball, shuffled. */
function drawRound(previous) {
  let target = previous;
  while (target === previous) target = pick(ALPHABET);
  const letters = [target];
  while (letters.length < BALLS) {
    const decoy = pick(ALPHABET);
    if (!letters.includes(decoy)) letters.push(decoy);
  }
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [letters[i], letters[j]] = [letters[j], letters[i]];
  }
  const first = Math.floor(Math.random() * COLORS.length);
  return {
    id: nextId++,
    target,
    sparks: drawSparks(),
    balls: letters.map((char, i) => ({
      char,
      color: COLORS[(first + i) % COLORS.length],
    })),
  };
}

/** A key the story list is already using to turn pages. */
function isStoryListKey() {
  return document.activeElement?.classList.contains("section-index-row");
}

/** Space would press whatever button has the focus; leave it to that button. */
function spaceIsFree() {
  const el = document.activeElement;
  return (
    !el ||
    el === document.body ||
    !el.matches("button, a[href], summary, [role='button'], [tabindex]")
  );
}

function Ball({ ball, className = "", onTap }) {
  const Tag = onTap ? "button" : "span";
  return (
    <Tag
      type={onTap ? "button" : undefined}
      className={`claw-ball${className}`}
      style={{ backgroundColor: ball.color }}
      onClick={onTap}
      aria-label={onTap ? `The letter ${ball.char}` : undefined}
    >
      {ball.char}
    </Tag>
  );
}

/** Same props as WaitingGame, which hands "claw" over to this. */
export default function ClawGame({
  visible,
  leaving,
  freePlay = false,
  onHide,
  onClose,
}) {
  const [round, setRound] = useState(() => drawRound(null));
  const [slot, setSlot] = useState(Math.floor(BALLS / 2));
  // "idle" → "down" → "up" → "won" | "wobble" → "idle". Only idle listens.
  const [phase, setPhase] = useState("idle");
  const [grabbed, setGrabbed] = useState(null); // index of the ball in the claw
  const [slipped, setSlipped] = useState(null); // index of a ball just dropped back
  const [found, setFound] = useState(0);
  const [tappable] = useState(
    () => !!window.matchMedia?.("(pointer: coarse)").matches
  );

  const latest = useRef({ round, slot, phase });
  const timers = useRef([]);
  const closeRef = useRef(onClose);
  const hideRef = useRef(onHide);
  useEffect(() => {
    latest.current = { round, slot, phase };
    closeRef.current = onClose;
    hideRef.current = onHide;
  });

  const later = useCallback((fn, ms) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    },
    []
  );

  /** Down, grip, up — then either the burst or the slip back into the pile. */
  const drop = useCallback(
    (at) => {
      const { round: current } = latest.current;
      latest.current.phase = "down"; // a second press must not drop twice
      setPhase("down");
      setSlipped(null);

      later(() => setGrabbed(at), DROP_MS);
      later(() => setPhase("up"), DROP_MS + GRIP_MS);

      const top = DROP_MS + GRIP_MS + LIFT_MS;
      if (current.balls[at].char === current.target) {
        later(() => {
          setPhase("won");
          setFound((n) => n + 1);
        }, top);
        later(() => {
          setGrabbed(null);
          setRound(drawRound(current.target));
          setPhase("idle");
        }, top + POOF_MS);
      } else {
        later(() => setPhase("wobble"), top);
        later(() => {
          setGrabbed(null);
          setSlipped(at);
          setPhase("idle");
        }, top + WOBBLE_MS);
      }
    },
    [later]
  );

  /** Slide over to a ball and go for it — a typed letter, or a tap. */
  const goFor = useCallback(
    (at) => {
      const { slot: from, phase: now } = latest.current;
      if (now !== "idle") return;
      latest.current.phase = "moving";
      setPhase("moving");
      setSlot(at);
      later(() => drop(at), from === at ? 0 : MOVE_MS);
    },
    [drop, later]
  );

  useEffect(() => {
    if (!visible || leaving) return undefined;

    const onKeyDown = (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "Escape") {
        hideRef.current();
        return;
      }
      if (isTyping(document.activeElement)) return;

      const { round: current, slot: at, phase: now } = latest.current;
      const arrows = !isStoryListKey();

      if (arrows && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        if (now !== "idle") return;
        const next = at + (e.key === "ArrowLeft" ? -1 : 1);
        setSlot(Math.min(BALLS - 1, Math.max(0, next)));
        setSlipped(null);
        return;
      }

      if ((arrows && e.key === "ArrowDown") || (e.key === " " && spaceIsFree())) {
        e.preventDefault();
        if (now === "idle" && !e.repeat) drop(at);
        return;
      }

      if (e.key.length !== 1) return;
      const char = e.key.toUpperCase();
      const index = current.balls.findIndex((b) => b.char === char);
      if (index >= 0) goFor(index);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drop, goFor, leaving, visible]);

  // The picture has landed: the whole machine goes out in a poof.
  useEffect(() => {
    if (!leaving) return undefined;
    const id = setTimeout(() => closeRef.current(), POOF_MS + 60);
    return () => clearTimeout(id);
  }, [leaving]);

  const held = grabbed === null ? null : round.balls[grabbed];
  const down = phase === "down";
  const closed = grabbed !== null;

  return (
    <div
      className={`waiting-letter${visible ? "" : " is-away"}`}
      aria-hidden={!visible}
    >
      <div
        className={`claw-machine${leaving ? " is-leaving" : ""}`}
        role="img"
        aria-label={`A claw machine. Get the letter ${round.target}!`}
      >
        <div className="claw-sign">
          <span>Get the</span>
          <b key={round.id}>{round.target}</b>
        </div>

        <div className="claw-glass">
          <i className="claw-rail" />
          <div
            className={`claw${down ? " is-down" : ""}${
              closed ? " is-closed" : ""
            }${phase === "wobble" ? " is-wobbling" : ""}`}
            style={{
              left: `${((slot + 0.5) / BALLS) * 100}%`,
              transitionDuration: `${MOVE_MS}ms`,
            }}
          >
            <i className="claw-cable" />
            <span className="claw-head">
              {held &&
                (phase === "won" ? (
                  <span className="claw-ball-poof">
                    <Ball ball={held} className=" is-poofing" />
                    {round.sparks.map((s, i) => (
                      <i
                        key={i}
                        style={{ "--dx": s.dx, "--dy": s.dy, background: s.color }}
                      />
                    ))}
                  </span>
                ) : (
                  <Ball ball={held} className=" is-held" />
                ))}
            </span>
          </div>

          <div className="claw-pile" key={round.id}>
            {round.balls.map((ball, i) => (
              <span key={i} className="claw-pile-slot">
                {grabbed !== i && (
                  <Ball
                    ball={ball}
                    className={slipped === i ? " is-slipped" : ""}
                    onTap={
                      tappable && phase === "idle" ? () => goFor(i) : undefined
                    }
                  />
                )}
              </span>
            ))}
          </div>
        </div>
      </div>

      {!leaving && (
        <p className="waiting-letter-pill">
          <span>
            {tappable
              ? `Tap the ${round.target}!`
              : `← → to move, ↓ to grab the ${round.target}`}
          </span>
          {found > 0 && <strong>⭐ {found}</strong>}
          <button
            type="button"
            className="waiting-letter-hide"
            onClick={onHide}
            title={
              freePlay
                ? "Stop playing (Esc)"
                : "Hide this until the next picture (Esc)"
            }
            aria-label={freePlay ? "Stop playing" : "Hide the waiting game"}
          >
            ✕
          </button>
        </p>
      )}
    </div>
  );
}
