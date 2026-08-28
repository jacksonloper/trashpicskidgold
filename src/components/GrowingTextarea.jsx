import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * A text box that is one line tall until its text needs more.
 *
 * Captions are usually short and occasionally a paragraph. An `<input>` shows
 * the tail of a long one and hides the rest; a fixed-height `<textarea>` gives
 * short captions a lot of empty box. This grows to whatever the text actually
 * takes, up to whatever `max-height` the stylesheet sets — past that it
 * scrolls like any other text box.
 */
export default function GrowingTextarea({ className = "", ...rest }) {
  const ref = useRef(null);

  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Let it shrink first: scrollHeight never reports less than the height
    // already set, so a caption that got shorter would keep the taller box.
    el.style.height = "auto";
    const style = getComputedStyle(el);
    // scrollHeight covers padding but not borders, which count towards the
    // height under border-box — without them the box stays a hair too short
    // and scrolls by that much.
    const borders =
      style.boxSizing === "border-box"
        ? parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
        : 0;
    el.style.height = `${el.scrollHeight + borders}px`;
  }, []);

  // Before paint, so a caption that arrives with the section is never drawn at
  // the wrong height first.
  useLayoutEffect(fit);

  // A narrower box wraps the same text onto more lines.
  useLayoutEffect(() => {
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [fit]);

  return (
    <textarea
      {...rest}
      ref={ref}
      rows={1}
      className={`growing-textarea ${className}`.trim()}
    />
  );
}
