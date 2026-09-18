import { useEffect, useRef } from "react";
import { WAITING_GAMES } from "../settingsStore";

/**
 * The grown-up's settings. For now that is one choice: which game the waiting
 * letter plays while a picture is being made.
 *
 * Escape or a click outside closes it. A change takes effect as soon as it is
 * clicked — there is nothing to save, and nothing here can lose work.
 */
export default function SettingsDialog({ settings, onChange, onClose }) {
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="plan-modal-overlay" onClick={onClose}>
      <div
        className="plan-modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="settings-title">⚙️ Settings</h3>

        <fieldset className="settings-group">
          <legend className="plan-label">Game while a picture is made</legend>
          {WAITING_GAMES.map((game) => (
            <label key={game.id} className="settings-option">
              <input
                type="radio"
                name="waiting-game"
                value={game.id}
                checked={settings.waitingGame === game.id}
                onChange={() => onChange({ ...settings, waitingGame: game.id })}
              />
              <span>
                <strong>{game.label}</strong>
                <small>{game.description}</small>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="plan-modal-buttons">
          <button
            type="button"
            className="btn-secondary"
            ref={closeRef}
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
