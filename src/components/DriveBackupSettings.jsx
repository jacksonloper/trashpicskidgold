/**
 * The Google Drive part of the settings dialog: connect, disconnect, back
 * up now, and a line saying how it is going.
 *
 * Deliberately plain. The decision a grown-up makes here is "yes, keep a
 * copy of these stories in my Drive" or "stop" — everything else is
 * automatic, and the words below say so. Nothing on this panel can change
 * a story: the backup only ever writes to Drive, and "Verify backups" only
 * compares Drive's checksums with the files here.
 */

import { tallyBackups } from "../driveBackup/backupState";

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

function plural(n, word) {
  return `${n} ${n === 1 ? word : `${word.replace(/y$/, "ie")}s`}`;
}

function describe(summary) {
  if (!summary) return null;
  if (summary.uploaded === 0) return "Last time: nothing had changed.";
  return `Last time: ${plural(summary.uploaded, "story")} sent up.`;
}

/** "All 12 stories verified on Drive", or what is still waiting or wrong. */
function describeTally(stories, records) {
  const t = tallyBackups(stories, records);
  const total = t.verified + t.waiting + t.differs;
  if (!total) return null;
  if (t.verified === total) {
    return total === 1
      ? "The story is verified on Drive."
      : `All ${total} stories verified on Drive.`;
  }
  const parts = [];
  if (t.verified) parts.push(`${t.verified} verified`);
  if (t.waiting) parts.push(`${t.waiting} waiting`);
  if (t.differs) parts.push(`${t.differs} ${t.differs === 1 ? "differs" : "differ"}`);
  return `${parts.join(", ")} on Drive.`;
}

function describeVerify(result) {
  if (!result) return null;
  if (result.differing.length) {
    return `${plural(result.differing.length, "story")} differ from Drive: ${result.differing.join(", ")}.`;
  }
  const bits = [`${plural(result.verified, "story")} verified`];
  if (result.waiting) bits.push(`${result.waiting} waiting to go up`);
  if (result.unverified) bits.push(`${result.unverified} not yet hashed by Drive`);
  return `${bits.join(", ")}.`;
}

export default function DriveBackupSettings({ drive, stories }) {
  const {
    configured,
    enabled,
    status,
    error,
    summary,
    progress,
    lastBackupAt,
    recordsByStoryId,
    verifying,
    verifyResult,
  } = drive;

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

  const busy = status === "backing-up" || verifying;
  const tallyLine = enabled ? describeTally(stories, recordsByStoryId) : null;

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
              {verifying &&
                (progress
                  ? `Checking… ${progress.done} of ${progress.total}`
                  : "Checking against Drive…")}
              {!verifying &&
                status === "backing-up" &&
                (progress
                  ? `Backing up… ${progress.done} of ${progress.total}`
                  : "Backing up…")}
              {!verifying &&
                status === "idle" &&
                `Backed up ${relative(lastBackupAt)}.${tallyLine ? ` ${tallyLine}` : ""}`}
              {status === "signin" &&
                "Google needs you to sign in again before the next backup."}
              {status === "error" &&
                `Last backup did not finish${lastBackupAt ? ` (last good one ${relative(lastBackupAt)})` : ""}.`}
              {status === "off" && "Connecting…"}
            </span>
            {status !== "backing-up" && !verifying && summary && (
              <>
                <br />
                <small>{describe(summary)}</small>
              </>
            )}
            {!verifying && verifyResult && (
              <>
                <br />
                <small>{describeVerify(verifyResult)}</small>
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
              onClick={drive.verifyAll}
              title="Compare every story's files here with Drive's checksums of what it holds. Nothing is sent or read back."
            >
              Verify backups
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
              Beside each story&rsquo;s title: ✅ on Drive and checked, ⏳
              waiting to go up, ❌ a file on Drive differs from the one here
              (it is sent again next backup). Disconnecting stops the backups
              and nothing else: the stories here and the files in Drive both
              stay where they are.
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
