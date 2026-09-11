import { useEffect, useRef, useState } from "react";

/**
 * What actually came back, for a failure that only left a line on the banner.
 *
 * The banner has room for one sentence, and one sentence is never enough when
 * a picture doesn't arrive: "Gemini sent a reply with no picture in it" is
 * true of a refused prompt, a model that ran out of room, and a bad minute at
 * Google's end, and those want three different things from the grown-up. So
 * the banner keeps its sentence and this holds everything behind it — what
 * happened, what the reply said about itself, what to try, and the reply
 * itself for the times when none of that is enough.
 *
 * Escape or a click outside closes it. Nothing here changes the story: it is
 * safe to open mid-generation, and the only button that does anything copies
 * the reply to the clipboard.
 *
 * Props:
 *   details – { title, what, facts: [{label, value}], saidInstead, tryThis: [], raw }
 *   onClose()
 */
export default function ErrorDetailsModal({ details, onClose }) {
  const closeRef = useRef(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // "Copied" is the only feedback there is — the clipboard says nothing back.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(details.raw ?? "");
      setCopied(true);
    } catch {
      // No clipboard (an insecure origin, a browser that says no). The reply
      // is on screen and selectable, which is the fallback.
      setCopied(false);
    }
  };

  const facts = details.facts ?? [];
  const tryThis = details.tryThis ?? [];

  return (
    <div className="plan-modal-overlay" onClick={onClose}>
      <div
        className="plan-modal error-details-modal"
        role="dialog"
        aria-modal="true"
        aria-label={details.title ?? "What happened"}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{details.title ?? "What happened"}</h3>
        {details.what && <p className="error-details-what">{details.what}</p>}

        {facts.length > 0 && (
          <dl className="error-details-facts">
            {facts.map((f, i) => (
              <div key={`${f.label}-${i}`}>
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {details.saidInstead && (
          <>
            <p className="plan-label">Gemini wrote this instead</p>
            <blockquote className="error-details-said">
              {details.saidInstead}
            </blockquote>
          </>
        )}

        {tryThis.length > 0 && (
          <>
            <p className="plan-label">What to try</p>
            <ul className="error-details-try">
              {tryThis.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </>
        )}

        {details.raw && (
          <details className="error-details-raw">
            <summary>The whole reply</summary>
            <pre>{details.raw}</pre>
          </details>
        )}

        <div className="plan-modal-buttons">
          <button
            type="button"
            className="btn-primary"
            ref={closeRef}
            onClick={onClose}
          >
            Close
          </button>
          {details.raw && (
            <button type="button" className="btn-secondary" onClick={handleCopy}>
              {copied ? "Copied" : "Copy the reply"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
