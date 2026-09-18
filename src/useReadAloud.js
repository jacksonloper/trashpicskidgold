import { useEffect, useRef } from "react";

/**
 * What a page says out loud: its caption, or the words of a text block.
 *
 * Markdown is written to be read on a screen, not spoken, so the punctuation
 * that only means something to a renderer is dropped: heading hashes, list
 * bullets, emphasis stars, backticks, and the URL half of a link.
 */
export function spokenText(section) {
  if (!section) return "";
  const raw =
    section.type === "illustration"
      ? section.caption ?? ""
      : section.content ?? "";
  return raw
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // [words](url) → words
    .replace(/^\s{0,3}#{1,6}\s+/gm, "") // heading hashes
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "") // list bullets
    .replace(/^\s*>\s?/gm, "") // blockquote bars
    .replace(/[*_`~]+/g, "") // emphasis and code marks
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** The one key that reads the page: a bare P, nowhere near a text box. */
function isReadKey(event) {
  const el = event.target;
  const typing =
    el &&
    (el.isContentEditable ||
      el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.tagName === "SELECT");
  return (
    (event.key === "p" || event.key === "P") &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !typing
  );
}

/** Stop whatever is being said, if the browser can say anything at all. */
export function stopReading() {
  const synth = globalThis.speechSynthesis;
  if (synth) synth.cancel();
}

/**
 * Read the selected page aloud on P while the story list has the keyboard.
 *
 * The kid can't read yet; this is how the page reads itself to them. A page
 * with nothing written on it says so rather than staying silent, because
 * silence after a keypress reads as "broken" to a four-year-old.
 *
 * Turning the page cuts the speech short — a caption still being read over a
 * different picture would be confusing — as does leaving the story.
 */
export default function useReadAloud(enabled, section) {
  const sectionRef = useRef(section);
  useEffect(() => {
    sectionRef.current = section;
  });

  // The page under the voice has changed: whatever it was saying is about the
  // last page, so stop it. (This also runs on the way out.)
  const sectionId = section?.id ?? null;
  useEffect(() => stopReading, [sectionId]);

  useEffect(() => {
    if (!enabled) return undefined;
    const synth = globalThis.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
      return undefined;
    }

    const handleKeyDown = (event) => {
      const listHasFocus =
        document.activeElement?.classList.contains("section-index-row");
      if (!listHasFocus || !isReadKey(event)) return;
      event.preventDefault();
      if (event.repeat) return;

      const text =
        spokenText(sectionRef.current) || "This page has no words yet.";
      // A second P starts over from the top rather than talking over itself.
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = document.documentElement.lang || "en";
      synth.speak(utterance);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      synth.cancel();
    };
  }, [enabled]);
}
