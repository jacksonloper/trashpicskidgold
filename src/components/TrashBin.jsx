import { useEffect } from "react";
import { TRASH_ORIGINS } from "../db";

/** "1.4 MB" — what the trash is holding, in units a person reads. */
function formatBytes(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * When a picture was thrown away.
 *
 * Recent enough and the clock is what matters ("this afternoon, before lunch");
 * older than that and only the date does.
 */
function formatWhen(ts) {
  if (!ts) return "";
  const when = new Date(ts);
  const sameDay = new Date().toDateString() === when.toDateString();
  return sameDay
    ? `today, ${when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : when.toLocaleDateString([], {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
}

/**
 * A file name for a picture being saved out of the trash.
 *
 * The caption is the only name a picture ever had, and the extension has to
 * come off the data-URL itself — a JPEG saved as .png opens crooked.
 */
function downloadName(entry) {
  const mime = (entry.data ?? "").split(";")[0].split(":")[1] ?? "image/png";
  const ext = mime.split("/")[1] === "jpeg" ? "jpg" : mime.split("/")[1];
  const stem =
    (entry.caption || "picture").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40) ||
    "picture";
  return `${stem}.${ext}`;
}

/**
 * The trash bin: every picture that has been taken out of a story, kept until
 * the user says otherwise.
 *
 * Nothing in here is deleted on a timer — that is the whole point — so the
 * window has to make both the keeping and the clearing obvious.
 *
 * Props:
 *   items       – trash records, newest first
 *   loading     – still reading them out of the database
 *   liveStoryIds – ids of stories that still exist; a picture whose story is
 *                  gone has nowhere to be put back to
 *   busyId      – id of the picture currently being restored or destroyed
 *   dialogOpen  – a confirm dialog is stacked on top and owns the keyboard
 *   onRestore(entry)
 *   onDeleteForever(entry)
 *   onEmpty()
 *   onClose()
 */
export default function TrashBin({
  items,
  loading,
  liveStoryIds,
  busyId,
  dialogOpen,
  onRestore,
  onDeleteForever,
  onEmpty,
  onClose,
}) {
  // Escape closes the trash — unless a confirm dialog is stacked on top, in
  // which case it is that dialog's to cancel, not this window's to close.
  useEffect(() => {
    if (dialogOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dialogOpen, onClose]);

  const totalBytes = items.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0);

  return (
    <div className="plan-modal-overlay" onClick={onClose}>
      <div
        className="plan-modal trash-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Trash"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>🗑️ Trash</h3>

        <p className="section-description">
          Every picture removed from a story lands here and stays — nothing in
          the trash is thrown away on its own. Put one back, or empty the trash
          when you are sure.
        </p>

        {loading ? (
          <p className="trash-empty">Opening the trash…</p>
        ) : items.length === 0 ? (
          <p className="trash-empty">
            The trash is empty. Pictures you remove from a story will show up
            here.
          </p>
        ) : (
          <>
            <div className="trash-summary">
              <span>
                <strong>{items.length}</strong>{" "}
                {items.length === 1 ? "picture" : "pictures"}
                {totalBytes > 0 && <> · {formatBytes(totalBytes)}</>}
              </span>
              <button
                type="button"
                className="btn-danger-solid"
                onClick={onEmpty}
              >
                🧹 Empty trash
              </button>
            </div>

            <ul className="trash-list">
              {items.map((entry) => {
                const canRestore = liveStoryIds.includes(entry.storyId);
                const busy = busyId === entry.id;
                return (
                  <li key={entry.id} className="trash-item">
                    {entry.data ? (
                      <img
                        className="trash-thumb"
                        src={entry.data}
                        alt={entry.caption || "Trashed picture"}
                      />
                    ) : (
                      <div className="trash-thumb trash-thumb-missing">🖼️</div>
                    )}

                    <div className="trash-item-body">
                      <p className="trash-caption">
                        {entry.caption || "No caption"}
                      </p>
                      <p className="trash-meta">
                        {entry.storyTitle || "Untitled"} —{" "}
                        {TRASH_ORIGINS[entry.origin] ?? "it was removed"}
                        {entry.deletedAt && <> · {formatWhen(entry.deletedAt)}</>}
                        {entry.bytes > 0 && <> · {formatBytes(entry.bytes)}</>}
                      </p>

                      <div className="trash-item-actions">
                        <button
                          type="button"
                          className="btn-small"
                          disabled={!canRestore || busy}
                          onClick={() => onRestore(entry)}
                          title={
                            canRestore
                              ? "Put this picture back into its story"
                              : "The story this belonged to is gone, so there is nowhere to put it back"
                          }
                        >
                          ↩️ Put back
                        </button>
                        {entry.data && (
                          <a
                            className="btn-small"
                            href={entry.data}
                            download={downloadName(entry)}
                            title="Save this picture to your computer"
                          >
                            ⬇️ Save
                          </a>
                        )}
                        <button
                          type="button"
                          className="btn-small btn-danger"
                          disabled={busy}
                          onClick={() => onDeleteForever(entry)}
                        >
                          ✕ Delete forever
                        </button>
                        {!canRestore && (
                          <span className="trash-note">
                            its story is gone — save it if you want to keep it
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <div className="plan-modal-buttons">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
