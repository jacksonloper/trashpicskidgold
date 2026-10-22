import { useState } from "react";
import ConfirmDialog from "./ConfirmDialog";
import { FORGET_PHRASE, forgetThisComputer } from "../forgetComputer";

const GOOGLE_CONNECTIONS = "https://myaccount.google.com/connections";

/**
 * For the computer the family is walking away from.
 *
 * Two things, for two moments. Remembering at home: a link to the page in
 * the Google account that signs every computer out of the backup at once.
 * Remembering before leaving: a button that wipes this browser — every
 * story, picture, the trash, the API key, the Drive sign-in — behind a
 * whole sentence typed out, so that no child, and no hurried grown-up,
 * ever reaches it by accident.
 */
export default function ForgetComputer() {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    setBusy(true);
    await forgetThisComputer();
  };

  return (
    <fieldset className="settings-group">
      <legend className="plan-label">Leaving this computer</legend>
      <p className="settings-note">
        Signed in on a computer you have left? Remove the app from your{" "}
        <a href={GOOGLE_CONNECTIONS} target="_blank" rel="noopener noreferrer">
          Google account
        </a>{" "}
        and every computer is signed out of the backup at once. The stories
        already on that computer stay there until someone clears them.
      </p>
      <p className="settings-note">
        Still at the computer? <strong>Forget everything</strong> removes every
        story and picture here, the trash, the API key, the settings and the
        Google sign-in, as if the app had never been opened. Copies in Google
        Drive are not touched.
      </p>
      <div className="plan-modal-buttons settings-drive-buttons">
        <button
          type="button"
          className="btn-small btn-danger"
          onClick={() => setAsking(true)}
        >
          Forget everything on this computer…
        </button>
      </div>

      {asking && (
        <ConfirmDialog
          title="Forget everything on this computer?"
          message={
            <>
              <p>
                Every story and picture in this browser will be destroyed, along
                with the trash, the API key, the settings and the Google Drive
                sign-in. The page will then reload to the entrance.
              </p>
              <p>
                Stories backed up to Google Drive stay in Drive. Anything not
                backed up or downloaded is gone for good.
              </p>
            </>
          }
          confirmPhrase={FORGET_PHRASE}
          phraseLabel={
            <>
              Type <code className="confirm-phrase">{FORGET_PHRASE}</code> to
              unlock
            </>
          }
          confirmLabel={busy ? "Forgetting…" : "Forget everything"}
          cancelLabel="Keep everything"
          onConfirm={busy ? () => {} : handleConfirm}
          onCancel={() => !busy && setAsking(false)}
        />
      )}
    </fieldset>
  );
}
