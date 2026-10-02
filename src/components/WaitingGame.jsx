import { useCallback, useEffect, useRef, useState } from "react";
import WAITING_PICTURES, {
  LAST_LETTER_WAITING_PICTURES,
} from "../waitingPictures";

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
 * - "last": a picture again, but the answer is the letter its name ends
 *   with — G for the dog, T for the cat. A caterpillar under the picture
 *   spells the name out, head first, with its tail segment empty: D, O, and
 *   then what? Its pictures are a separate list, every name ending on a letter
 *   you can hear, and the empty segment is the only answer it takes.
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
 * A picture, the letters that answer it, and — for a touch screen — a few
 * letters to choose from, one of them right.
 *
 * @param answersOf  the letters a picture takes: every first letter its names
 *                   have, or the one letter the spelled-out name ends on
 */
function drawPicture(pictures, previous, answersOf) {
  let picture = null;
  while (!picture || picture.emoji === previous) picture = pick(pictures);
  const answers = answersOf(picture);
  const choices = [answers[0]];
  while (choices.length < CHOICES) {
    const decoy = pick(ALPHABET);
    if (!answers.includes(decoy) && !choices.includes(decoy)) {
      choices.push(decoy);
    }
  }
  choices.sort();
  return { char: picture.emoji, answers, word: picture.word, choices };
}

/** The letters a picture's names start with — D or P for a 🐶. */
const firstLetters = (picture) => picture.answers;

/**
 * The one letter the name on the caterpillar ends with. The list already
 * holds a single answer per picture; reading it off the word anyway means the
 * empty segment and the key that fills it can never be two different letters.
 */
const lastLetterOfWord = (picture) => [picture.word.at(-1).toUpperCase()];

/** The next thing to find: what shows, what answers it, and its colour. */
function drawTarget(game, previous) {
  const drawn =
    game === "picture"
      ? drawPicture(WAITING_PICTURES, previous, firstLetters)
      : game === "last"
        ? drawPicture(LAST_LETTER_WAITING_PICTURES, previous, lastLetterOfWord)
        : drawLetter(previous);
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
 * The word under the picture in the last-letter game, spelled out along a
 * caterpillar: a face, then a segment per letter, in rainbow order from the
 * target's own colour. The tail segment is the one being asked for — empty
 * and waiting until the right key fills it in.
 *
 * @param filled  the word has been answered: show the last letter too
 * @param wrong   a wrong key was just pressed: the empty segment shakes
 */
function Caterpillar({ word, color, filled, wrong }) {
  const letters = word.toUpperCase().split("");
  const first = Math.max(0, COLORS.indexOf(color));
  return (
    <span
      className={`waiting-caterpillar${wrong ? " is-wrong" : ""}`}
      aria-hidden="true"
    >
      <i
        className="waiting-caterpillar-head"
        style={{ backgroundColor: COLORS[first] }}
      />
      {letters.map((letter, i) => {
        const last = i === letters.length - 1;
        const background = COLORS[(first + i + 1) % COLORS.length];
        return (
          <b
            key={i}
            className={`waiting-caterpillar-segment${
              last ? (filled ? " is-filled" : " is-asked") : ""
            }`}
            style={
              last && !filled
                ? { color: background, borderColor: background }
                : { background }
            }
          >
            {last && !filled ? "?" : letter}
          </b>
        );
      })}
    </span>
  );
}

/**
 * @param game      "letter", "picture" or "last" — which game to play. The first target
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
  const picture = game === "picture" || game === "last";
  // The last-letter game spells the name out, so nothing about it is a secret
  // but the one letter asked for.
  const spelled = game === "last";
  const ends = spelled ? "end" : "start";
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
    ? `What letter does it ${ends} with?`
    : tappable
      ? "Tap the letter!"
      : "Type the letter!";
  // A picture nobody can name is no fun: after a couple of misses, say its
  // name — unless it is already spelled out underneath.
  const hint =
    picture && !spelled && target && misses >= HINT_AFTER ? target.word : null;
  const label = spelled
    ? `A ${target?.word}, spelled ${target?.word
        .slice(0, -1)
        .toUpperCase()
        .split("")
        .join(", ")}, and one more. What letter does it end with?`
    : picture
      ? `A ${target?.word}. What letter does it ${ends} with?`
      : `Find the letter ${target?.char}`;
  // The caterpillar stays while the answered word poofs, filled in at last.
  const spelling = spelled && !leaving ? (target ?? poof) : null;

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

      {spelling && (
        <Caterpillar
          key={spelling.id}
          word={spelling.word}
          color={spelling.color}
          filled={!target}
          wrong={wrong}
        />
      )}

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
