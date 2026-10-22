/**
 * The Google Drive part of the settings dialog: connect, disconnect, back
 * up now, and a line saying how it is going.
 *
 * Deliberately plain. The decision a grown-up makes here is "yes, keep a
 * copy of these stories in my Drive" or "stop" — everything else is
 * automatic, and the words below say so. Nothing on this panel can change
 * a story: the backup only ever writes to Drive.
 */

function relative(ts) {
  if (!ts) return "never";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"} ago`;
  return new Date(ts).toLocaleDateString();
}

function describe(summary) {
  if (!summary) return null;
  if (summary.uploaded === 0) return "Last time: nothing had changed.";
  return `Last time: ${summary.uploaded} ${summary.uploaded === 1 ? "story" : "stories"} sent up.`;
}

export default function DriveBackupSettings({ drive }) {
  const { configured, enabled, status, error, summary, progress, lastBackupAt } =
    drive;

  if (!configured) {
    return (
      <fieldset className="settings-group">
        <legend className="plan-label">Google Drive backup</legend>
        <p className="settings-note">
          Not set up on this build. A copy of the app with a Google OAuth
          client id (<code>VITE_GOOGLE_CLIENT_ID</code>) can keep every story
          backed up to a folder in Google Drive. The README says how.
        </p>
      </fieldset>
    );
  }

  const busy = status === "backing-up";

  return (
    <fieldset className="settings-group">
      <legend className="plan-label">Google Drive backup</legend>

      {!enabled ? (
        <>
          <p className="settings-note">
            Keep a copy of every story in a <strong>trashpicskidgold</strong>{" "}
            folder in your Google Drive: one folder per story, laid out like
            an unpacked Export ZIP, each picture sent up once and every
            version of the words kept. Drive is only ever written to — nothing
            here is changed by it — and the app can only see files it made
            itself. To restore, download a story&rsquo;s folder from Drive as
            a ZIP and hand it to Import.
          </p>
          <div className="plan-modal-buttons settings-drive-buttons">
            <button
              type="button"
              className="btn-primary"
              onClick={drive.connect}
            >
              ☁️ Connect Google Drive
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="settings-note">
            <span className={`drive-status drive-status-${status}`}>
              {status === "backing-up" &&
                (progress
                  ? `Backing up… ${progress.done} of ${progress.total}`
                  : "Backing up…")}
              {status === "idle" && `Backed up ${relative(lastBackupAt)}.`}
              {status === "signin" &&
                "Google needs you to sign in again before the next backup."}
              {status === "error" &&
                `Last backup did not finish${lastBackupAt ? ` (last good one ${relative(lastBackupAt)})` : ""}.`}
              {status === "off" && "Connecting…"}
            </span>
            {status !== "backing-up" && summary && (
              <>
                <br />
                <small>{describe(summary)}</small>
              </>
            )}
          </p>
          <div className="plan-modal-buttons settings-drive-buttons">
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => drive.backUpNow({ interactive: true })}
            >
              {status === "signin" ? "Sign in and back up" : "Back up now"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={drive.disconnect}
            >
              Disconnect
            </button>
          </div>
          <p className="settings-note">
            <small>
              Disconnecting stops the backups and nothing else: the stories
              here and the files in Drive both stay where they are.
            </small>
          </p>
        </>
      )}

      {error && (
        <p className="settings-note drive-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
