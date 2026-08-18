import { useEffect, useRef, useState } from "react";

/**
 * Small modal that asks the user to confirm a destructive action.
 *
 * Escape or a click outside cancels. When `confirmPhrase` is given the user
 * must type it back verbatim before the destructive button unlocks; otherwise
 * the cancel button takes focus so a stray Enter keypress never confirms.
 *
 * Props:
 *   title        – heading text
 *   message      – body node/text explaining what will happen
 *   confirmPhrase – text the user must type to unlock confirmation (optional)
 *   phraseLabel  – node describing what to type (defaults to a generic prompt)
 *   confirmLabel – label for the destructive button (default "Delete")
 *   cancelLabel  – label for the safe button (default "Cancel")
 *   onConfirm()
 *   onCancel()
 */
export default function ConfirmDialog({
  title,
  message,
  confirmPhrase,
  phraseLabel,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}) {
  const cancelRef = useRef(null);
  const inputRef = useRef(null);
  const [typed, setTyped] = useState("");

  // Whitespace around the phrase is forgiven; everything else must match.
  const locked = !!confirmPhrase && typed.trim() !== confirmPhrase.trim();

  useEffect(() => {
    if (confirmPhrase) inputRef.current?.focus();
    else cancelRef.current?.focus();
    const onKeyDown = (e) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmPhrase, onCancel]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!locked) onConfirm();
  };

  return (
    <div className="plan-modal-overlay" onClick={onCancel}>
      <div
        className="plan-modal confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{title}</h3>
        <div className="confirm-message">{message}</div>

        <form onSubmit={handleSubmit}>
          {confirmPhrase && (
            <>
              <label className="plan-label" htmlFor="confirm-phrase">
                {phraseLabel ?? (
                  <>
                    Type <code className="confirm-phrase">{confirmPhrase}</code>{" "}
                    to confirm
                  </>
                )}
              </label>
              <input
                id="confirm-phrase"
                ref={inputRef}
                type="text"
                className="caption-input"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                spellCheck="false"
                aria-describedby="confirm-phrase-hint"
              />
              <p id="confirm-phrase-hint" className="confirm-note">
                {locked
                  ? "Doesn't match yet — deletion stays locked."
                  : "Matches. Deletion is unlocked."}
              </p>
            </>
          )}

          <div className="plan-modal-buttons">
            <button
              type="button"
              className="btn-secondary"
              ref={cancelRef}
              onClick={onCancel}
            >
              {cancelLabel}
            </button>
            <button
              type="submit"
              className="btn-danger-solid"
              disabled={locked}
              title={locked ? "Type the phrase above to unlock" : undefined}
            >
              {confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
