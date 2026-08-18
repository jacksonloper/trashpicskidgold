import { useEffect, useState } from "react";

/**
 * Transient bar offering to undo the last deletion.
 *
 * Props:
 *   message    – what happened, e.g. 'Deleted "My Story"'
 *   seconds    – how long the undo stays available (default 15)
 *   onUndo()
 *   onDismiss() – called when the user dismisses or the timer runs out
 */
export default function UndoToast({ message, seconds = 15, onUndo, onDismiss }) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    const tick = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(tick);
          onDismiss();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [onDismiss]);

  return (
    <div className="undo-toast" role="status">
      <span className="undo-toast-message">{message}</span>
      <button type="button" className="undo-toast-btn" onClick={onUndo}>
        ↩️ Undo ({remaining}s)
      </button>
      <button
        type="button"
        className="undo-toast-close"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        ✕
      </button>
    </div>
  );
}
