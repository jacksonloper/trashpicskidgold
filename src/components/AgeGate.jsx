import { useState, useCallback } from "react";
import { recordAgreement } from "../ageGateStore";

export default function AgeGate({ onAccept }) {
  const [checked, setChecked] = useState(false);

  const handleEnter = useCallback(() => {
    if (!checked) return;
    recordAgreement();
    onAccept();
  }, [checked, onAccept]);

  return (
    <div className="age-gate-overlay">
      <div className="age-gate-dialog">
        <h2>Adults Only</h2>
        <p>
          This site is for adults who are helping children create stories.
          Children may not use the site directly.
        </p>
        <p className="age-gate-legal">
          By entering, you confirm that you are 18+, that you will not submit
          sensitive child information, that you will review all AI outputs before
          showing them to any child, and that you are solely responsible for your
          prompts, uploads, downloads, sharing, and legal compliance. AI output
          may be inaccurate, inappropriate, non-original, or restricted by
          third-party rights. Use of this site and any output is at your own
          risk.
        </p>
        <p className="age-gate-warning" role="alert">
          <strong>Your stories live only in this browser.</strong> We do not
          want to hold your child&rsquo;s content on a server, so stories are
          kept in the browser&rsquo;s own storage, which the browser may
          delete at any time &mdash; Safari does so after a week of not
          visiting. Download a story after writing it, or back up to Google
          Drive in Settings.
        </p>
        <label className="age-gate-check">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          I am an adult and I agree.
        </label>
        <button
          type="button"
          className="btn-primary age-gate-btn"
          disabled={!checked}
          onClick={handleEnter}
        >
          Enter
        </button>
      </div>
    </div>
  );
}
