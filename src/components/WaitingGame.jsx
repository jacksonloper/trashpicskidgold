import { useCallback, useEffect, useRef, useState } from "react";
import WAITING_PICTURES from "../waitingPictures";

/*
 * Something to find while a picture is being made.
 *
 * A generation is half a minute or more of nothing happening, which is forever
 * to the kid who asked for the picture. So something floats in the middle of
 * the window and waits for a key:
 *
 * - "letter": a letter. Find it on the keyboard, it poofs, another takes its
 *   place.
 * - "picture": a picture — a dog, a cat, an apple. Type the letter its name
 *   starts with. D for the dog, C for the cat.
 *
 * It deliberately does not cover the page. There is no panel, no dimmed
 * backdrop and no pointer events anywhere except the little ✕ (and the answer
 * buttons on a touch screen) — the story, the buttons and the picture as it
 * lands are all still there to be seen and used, and the grown-up's keyboard
 * stays theirs the moment they put the caret in a text box.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const COLORS = [
  "#e5397c",
  "#f2760c",
  "#e0a800",
  "#2fa84f",
  "#1f8fe0",
  "#8b5cf6",
];

/** How long a target takes to vanish, and how long until the next one. */
const POOF_MS = 420;
const SPARKS = 12;
/** Wrong guesses at a picture before its name is whispered. */
const HINT_AFTER = 2;
/** Letters to pick from on a touch screen, where there is no keyboard. */
const CHOICES = 3;

let nextId = 1;

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/** The burst a target goes out in. */
function drawSparks() {
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

/** A letter, and the one key that answers it. */
function drawLetter(previous) {
  let char = previous;
  while (char === previous) char = pick(ALPHABET);
  return { char, answers: [char], word: null, choices: null };
}

/**
 * A picture, the letters its name may start with, and — for a touch screen —
 * a few letters to choose from, one of them right.
 */
function drawPicture(previous) {
  let picture = null;
  while (!picture || picture.emoji === previous) picture = pick(WAITING_PICTURES);
  const choices = [picture.answers[0]];
  while (choices.length < CHOICES) {
    const decoy = pick(ALPHABET);
    if (!picture.answers.includes(decoy) && !choices.includes(decoy)) {
      choices.push(decoy);
    }
  }
  choices.sort();
  return {
    char: picture.emoji,
    answers: picture.answers,
    word: picture.word,
    choices,
  };
}

/** The next thing to find: what shows, what answers it, and its colour. */
function drawTarget(game, previous) {
  const drawn = game === "picture" ? drawPicture(previous) : drawLetter(previous);
  return { id: nextId++, color: pick(COLORS), sparks: drawSparks(), ...drawn };
}

/** Somewhere a letter key means a letter, not a guess. */
function isTyping(el) {
  if (!el) return false;
  return (
    el.isContentEditable ||
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT"
  );
}

/** A target on its way out: the glyph blowing up, and the burst behind it. */
function Poof({ target, picture }) {
  return (
    <span className="waiting-letter-poof" aria-hidden="true">
      <span
        className={`waiting-letter-glyph is-poofing${picture ? " is-picture" : ""}`}
        style={{ color: target.color }}
      >
        {target.char}
      </span>
      {target.sparks.map((s, i) => (
        <i
          key={i}
          style={{ "--dx": s.dx, "--dy": s.dy, background: s.color }}
        />
      ))}
    </span>
  );
}

/**
 * @param game      "letter" or "picture" — which game to play. The first target
 *                  is dealt on mount, so a switch mid-wait wants a new `key`.
 * @param freePlay  nothing is being made: the ✕ ends the game rather than
 *                  hiding it until the next picture
 */
export default function WaitingGame({
  game = "letter",
  visible,
  leaving,
  freePlay = false,
  onHide,
  onClose,
}) {
  const picture = game === "picture";
  const [target, setTarget] = useState(() => drawTarget(game, null));
  const [poof, setPoof] = useState(null);
  const [found, setFound] = useState(0);
  const [wrong, setWrong] = useState(false);
  const [misses, setMisses] = useState(0);
  // No keyboard to type on, so the answer has to be something to tap instead.
  const [tappable] = useState(
    () => !!window.matchMedia?.("(pointer: coarse)").matches
  );

  const targetRef = useRef(target);
  const timers = useRef([]);
  const closeRef = useRef(onClose);
  const hideRef = useRef(onHide);
  const gameRef = useRef(game);
  useEffect(() => {
    targetRef.current = target;
    closeRef.current = onClose;
    hideRef.current = onHide;
    gameRef.current = game;
  });

  const later = useCallback((fn, ms) => {
    const id = setTimeout(fn, ms);
    timers.current.push(id);
    return id;
  }, []);

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    },
    []
  );

  const guess = useCallback(
    (char) => {
      const current = targetRef.current;
      if (!current) return; // mid-poof: the target is already gone

      if (!current.answers.includes(char)) {
        // Wrong keys cost nothing. The target just shakes its head.
        setWrong(true);
        setMisses((n) => n + 1);
        later(() => setWrong(false), 420);
        return;
      }

      targetRef.current = null; // a second press must not score twice
      setTarget(null);
      setWrong(false);
      setMisses(0);
      setPoof(current);
      setFound((n) => n + 1);
      later(() => {
        const next = drawTarget(gameRef.current, current.char);
        targetRef.current = next;
        setTarget(next);
        setPoof(null);
      }, POOF_MS);
    },
    [later]
  );

  /*
   * The keyboard, borrowed rather than taken: nothing is prevented, and a
   * letter typed into a caption is a letter in the caption.
   */
  useEffect(() => {
    if (!visible || leaving) return undefined;

    const onKeyDown = (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      // Escape works even mid-caption — it is the way to make this go away.
      if (e.key === "Escape") {
        hideRef.current();
        return;
      }
      if (e.key.length !== 1 || isTyping(document.activeElement)) return;
      const char = e.key.toUpperCase();
      if (char >= "A" && char <= "Z") guess(char);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [guess, leaving, visible]);

  // The picture has landed: wave the last target off, then go.
  useEffect(() => {
    if (!leaving) return undefined;
    const id = setTimeout(() => closeRef.current(), POOF_MS + 60);
    return () => clearTimeout(id);
  }, [leaving]);

  const prompt = picture
    ? "What letter does it start with?"
    : tappable
      ? "Tap the letter!"
      : "Type the letter!";
  // A picture nobody can name is no fun: after a couple of misses, say its name.
  const hint = picture && target && misses >= HINT_AFTER ? target.word : null;
  const label = picture
    ? `A ${target?.word}. What letter does it start with?`
    : `Find the letter ${target?.char}`;

  return (
    <div
      className={`waiting-letter${visible ? "" : " is-away"}`}
      aria-hidden={!visible}
    >
      <div className="waiting-letter-stack">
        {poof && <Poof key={`poof-${poof.id}`} target={poof} picture={picture} />}

        {target &&
          (leaving ? (
            <Poof key={`bye-${target.id}`} target={target} picture={picture} />
          ) : (
            <span
              key={target.id}
              className={`waiting-letter-glyph${wrong ? " is-wrong" : ""}${
                picture ? " is-picture" : ""
              }${tappable && !picture ? " is-tappable" : ""}`}
              style={{ color: target.color }}
              role="img"
              aria-label={label}
              onClick={
                tappable && !picture ? () => guess(target.char) : undefined
              }
            >
              {target.char}
            </span>
          ))}
      </div>

      {!leaving && (
        <p className="waiting-letter-pill">
          <span>{hint ? `It's a ${hint}!` : prompt}</span>
          {tappable && picture && target && (
            <span className="waiting-letter-choices">
              {target.choices.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="waiting-letter-choice"
                  onClick={() => guess(c)}
                  aria-label={`The letter ${c}`}
                >
                  {c}
                </button>
              ))}
            </span>
          )}
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
