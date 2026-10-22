/**
 * The Google Drive part of the settings dialog: connect, disconnect, sync
 * now, and a line saying how it is going.
 *
 * Deliberately plain. The decisions a grown-up makes here are "yes, keep a
 * copy of these stories in my Drive" and "stop" — everything else is
 * automatic, and the words below say so.
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
  const bits = [];
  const n = (count, one, many) =>
    count > 0 && bits.push(`${count} ${count === 1 ? one : many}`);
  n(summary.uploaded, "story sent up", "stories sent up");
  n(summary.downloaded, "story brought down", "stories brought down");
  n(summary.copies, "copy made from a clash", "copies made from clashes");
  n(summary.trashedRemote, "story trashed on Drive", "stories trashed on Drive");
  n(summary.deletedLocal, "story removed here", "stories removed here");
  return bits.length ? `Last time: ${bits.join(", ")}.` : "Last time: nothing had changed.";
}

export default function DriveSyncSettings({ drive }) {
  const { configured, enabled, status, error, summary, progress, lastSyncAt } =
    drive;

  if (!configured) {
    return (
      <fieldset className="settings-group">
        <legend className="plan-label">Google Drive</legend>
        <p className="settings-note">
          Not set up on this build. A copy of the app with a Google OAuth
          client id (<code>VITE_GOOGLE_CLIENT_ID</code>) can keep every story
          backed up to a folder in Google Drive. The README says how.
        </p>
      </fieldset>
    );
  }

  const busy = status === "syncing";

  return (
    <fieldset className="settings-group">
      <legend className="plan-label">Google Drive</legend>

      {!enabled ? (
        <>
          <p className="settings-note">
            Keep a copy of every story in a <strong>Story Maker</strong>{" "}
            folder in your Google Drive, as the same ZIPs Export makes. Stories
            made on another computer signed in to the same Drive come here too.
            The app can only see files it made itself.
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
              {status === "syncing" &&
                (progress
                  ? `Syncing… ${progress.done} of ${progress.total}`
                  : "Syncing…")}
              {status === "idle" && `Synced ${relative(lastSyncAt)}.`}
              {status === "signin" &&
                "Google needs you to sign in again before the next sync."}
              {status === "error" && `Last sync did not finish${lastSyncAt ? ` (last good one ${relative(lastSyncAt)})` : ""}.`}
              {status === "off" && "Connecting…"}
            </span>
            {status !== "syncing" && summary && (
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
              onClick={() => drive.syncNow({ interactive: true })}
            >
              {status === "signin" ? "Sign in and sync" : "Sync now"}
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
              Disconnecting stops the syncing and nothing else: the stories
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
