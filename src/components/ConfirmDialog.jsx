import { useEffect, useRef } from "react";

/**
 * Small modal that asks the user to confirm a destructive action.
 *
 * Escape or a click outside cancels; the cancel button is focused on open so
 * a stray Enter keypress never confirms.
 *
 * Props:
 *   title        – heading text
 *   message      – body node/text explaining what will happen
 *   confirmLabel – label for the destructive button (default "Delete")
 *   cancelLabel  – label for the safe button (default "Cancel")
 *   onConfirm()
 *   onCancel()
 */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}) {
  const cancelRef = useRef(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKeyDown = (e) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

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

        <div className="plan-modal-buttons">
          <button
            type="button"
            className="btn-secondary"
            ref={cancelRef}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button type="button" className="btn-danger-solid" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
