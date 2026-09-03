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
 * It opens two ways. From the navbar it is the bin itself: what is in there,
 * how much room it is taking, and what to throw away. From a page it is a
 * picker — "take illustration from trash" — and then the only thing worth
 * offering is the picture itself, so the destructive half stays out of the way.
 *
 * Props:
 *   items       – trash records, newest first
 *   loading     – still reading them out of the database
 *   busyId      – id of the picture currently being moved or destroyed
 *   dialogOpen  – a confirm dialog is stacked on top and owns the keyboard
 *   pickLabel   – the page a picked picture would land on; picker mode when set
 *   onUse(entry) – required in picker mode
 *   onDeleteForever(entry)
 *   onEmpty()
 *   onClose()
 */
export default function TrashBin({
  items,
  loading,
  busyId,
  dialogOpen,
  pickLabel,
  onUse,
  onDeleteForever,
  onEmpty,
  onClose,
}) {
  const picking = !!pickLabel;
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
        <h3>{picking ? "🗑️ Take a picture from the trash" : "🗑️ Trash"}</h3>

        <p className="section-description">
          {picking ? (
            <>
              Pick a picture to put on <strong>{pickLabel}</strong>. It comes
              out of the trash and onto the page — and whatever is on that page
              now takes its place in here.
            </>
          ) : (
            <>
              Every picture removed from a story lands here and stays — nothing
              in the trash is thrown away on its own. Put one back on a page
              from that page's <em>take illustration from trash</em> button, or
              empty the trash when you are sure.
            </>
          )}
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
              {!picking && (
                <button
                  type="button"
                  className="btn-danger-solid"
                  onClick={onEmpty}
                >
                  🧹 Empty trash
                </button>
              )}
            </div>

            <ul className="trash-list">
              {items.map((entry) => {
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
                        {picking && (
                          <button
                            type="button"
                            className="btn-small btn-use"
                            disabled={busy || !entry.data}
                            onClick={() => onUse(entry)}
                          >
                            ↩️ Use on this page
                          </button>
                        )}
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
                        {!picking && (
                          <button
                            type="button"
                            className="btn-small btn-danger"
                            disabled={busy}
                            onClick={() => onDeleteForever(entry)}
                          >
                            ✕ Delete forever
                          </button>
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
            {picking ? "Cancel" : "Close"}
          </button>
        </div>
      </div>
    </div>
  );
}
