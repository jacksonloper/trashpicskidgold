import { useCallback, useEffect, useRef, useState } from "react";

/*
 * A letter to find while a picture is being made.
 *
 * A generation is half a minute or more of nothing happening, which is forever
 * to the kid who asked for the picture. So a letter floats in the middle of the
 * window: find it on the keyboard, it poofs, another one takes its place.
 *
 * It deliberately does not cover the page. There is no panel, no dimmed
 * backdrop and no pointer events anywhere except the little ✕ — the story, the
 * buttons and the picture as it lands are all still there to be seen and used,
 * and the grown-up's keyboard stays theirs the moment they put the caret in a
 * text box.
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

/** How long a letter takes to vanish, and how long until the next one. */
const POOF_MS = 420;
const SPARKS = 12;

let nextId = 1;

/** A letter, its colour and the burst it will go out in. */
function drawLetter(previous) {
  let char = previous;
  while (char === previous) {
    char = ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  const sparks = Array.from({ length: SPARKS }, (unused, i) => {
    const angle = (Math.PI * 2 * i) / SPARKS + Math.random() * 0.5;
    const distance = 70 + Math.random() * 80;
    return {
      dx: `${Math.round(Math.cos(angle) * distance)}px`,
      dy: `${Math.round(Math.sin(angle) * distance)}px`,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    };
  });
  return {
    id: nextId++,
    char,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    sparks,
  };
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

/** A letter on its way out: the glyph blowing up, and the burst behind it. */
function Poof({ letter }) {
  return (
    <span className="waiting-letter-poof" aria-hidden="true">
      <span className="waiting-letter-glyph is-poofing" style={{ color: letter.color }}>
        {letter.char}
      </span>
      {letter.sparks.map((s, i) => (
        <i
          key={i}
          style={{ "--dx": s.dx, "--dy": s.dy, background: s.color }}
        />
      ))}
    </span>
  );
}

export default function WaitingGame({ visible, leaving, onHide, onClose }) {
  const [target, setTarget] = useState(() => drawLetter(null));
  const [poof, setPoof] = useState(null);
  const [found, setFound] = useState(0);
  const [wrong, setWrong] = useState(false);
  // No keyboard to type on, so the letter itself takes a tap instead.
  const [tappable] = useState(
    () => !!window.matchMedia?.("(pointer: coarse)").matches
  );

  const targetRef = useRef(target);
  const timers = useRef([]);
  const closeRef = useRef(onClose);
  const hideRef = useRef(onHide);
  useEffect(() => {
    targetRef.current = target;
    closeRef.current = onClose;
    hideRef.current = onHide;
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
      if (!current) return; // mid-poof: the letter is already gone

      if (char !== current.char) {
        // Wrong keys cost nothing. The letter just shakes its head.
        setWrong(true);
        later(() => setWrong(false), 420);
        return;
      }

      targetRef.current = null; // a second press must not score twice
      setTarget(null);
      setWrong(false);
      setPoof(current);
      setFound((n) => n + 1);
      later(() => {
        const next = drawLetter(current.char);
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

  // The picture has landed: wave the last letter off, then go.
  useEffect(() => {
    if (!leaving) return undefined;
    const id = setTimeout(() => closeRef.current(), POOF_MS + 60);
    return () => clearTimeout(id);
  }, [leaving]);

  return (
    <div
      className={`waiting-letter${visible ? "" : " is-away"}`}
      aria-hidden={!visible}
    >
      <div className="waiting-letter-stack">
        {poof && <Poof key={`poof-${poof.id}`} letter={poof} />}

        {target &&
          (leaving ? (
            <Poof key={`bye-${target.id}`} letter={target} />
          ) : (
            <span
              key={target.id}
              className={`waiting-letter-glyph${wrong ? " is-wrong" : ""}${
                tappable ? " is-tappable" : ""
              }`}
              style={{ color: target.color }}
              role="img"
              aria-label={`Find the letter ${target.char}`}
              onClick={tappable ? () => guess(target.char) : undefined}
            >
              {target.char}
            </span>
          ))}
      </div>

      {!leaving && (
        <p className="waiting-letter-pill">
          <span>{tappable ? "Tap the letter!" : "Type the letter!"}</span>
          {found > 0 && <strong>⭐ {found}</strong>}
          <button
            type="button"
            className="waiting-letter-hide"
            onClick={onHide}
            title="Hide this until the next picture (Esc)"
            aria-label="Hide the letter game"
          >
            ✕
          </button>
        </p>
      )}
    </div>
  );
}
