import { backupState, BACKUP_GLYPH } from "../driveBackup/backupState";

export default function Navbar({
  ref,
  stories,
  activeStoryId,
  onSelectStory,
  onNewStory,
  onDeleteStory,
  onLoadExample,
  loadingExample,
  onImport,
  importing,
  onOpenTrash,
  trashCount,
  onOpenSettings,
  driveStatus,
  driveRecords,
  unsavedStoryId,
}) {
  const handleImportChange = (e) => {
    const files = Array.from(e.target.files ?? []);
    // Reset first, so picking the same file twice still fires a change event.
    e.target.value = "";
    if (files.length) onImport(files);
  };

  return (
    // The ref is how App measures the sticky bar: everything that scrolls
    // something into view has to know how much of the top it covers.
    <nav className="navbar" ref={ref}>
      <span className="navbar-brand">📖 Story Maker</span>

      <div className="navbar-stories">
        <select
          className="story-select"
          value={activeStoryId || ""}
          onChange={(e) => onSelectStory(e.target.value)}
        >
          {stories.length === 0 && (
            <option value="" disabled>
              No stories yet
            </option>
          )}
          {/* With the backup on, each title gets a glyph: ✅ on Drive and
              checked, ⏳ waiting to go up, ❌ a file on Drive differs. A story
              this browser refused to save gets ❗ whatever Drive says: what
              Drive holds is not what is on screen. */}
          {stories.map((s) => (
            <option key={s.id} value={s.id}>
              {s.id === unsavedStoryId
                ? "❗ "
                : driveRecords
                  ? `${BACKUP_GLYPH[backupState(s, driveRecords[s.id])]} `
                  : ""}
              {s.title || "Untitled"}
            </option>
          ))}
        </select>

        <button type="button" className="btn-small" onClick={onNewStory}>
          + New Story
        </button>

        <button
          type="button"
          className="btn-small"
          onClick={onLoadExample}
          disabled={loadingExample}
          title="Load a pre-made example story for testing"
        >
          {loadingExample ? "Loading…" : "📋 Example"}
        </button>

        <label
          className="btn-small ref-upload-label"
          title="Load story ZIPs previously downloaded from Export"
        >
          {importing ? "Importing…" : "📥 Import"}
          <input
            type="file"
            accept=".zip,application/zip"
            multiple
            disabled={importing}
            style={{ display: "none" }}
            onChange={handleImportChange}
          />
        </label>

        <button
          type="button"
          className="btn-small"
          onClick={onOpenTrash}
          title="Pictures removed from a story wait here until you empty the trash"
        >
          🗑️ Trash
          {trashCount > 0 && (
            <span className="trash-count-badge">{trashCount}</span>
          )}
        </button>

        {activeStoryId && (
          <button
            type="button"
            className="btn-small btn-danger"
            onClick={onDeleteStory}
          >
            🗑️ Delete story
          </button>
        )}

        <button
          type="button"
          className="btn-small"
          onClick={onOpenSettings}
          title="Choose which game is played while a picture is being made, and whether stories are backed up to Google Drive"
        >
          ⚙️ Settings
          {/* A small cloud says the stories are being backed up to Drive, and goes
              amber or red when Google wants something from a grown-up. */}
          {driveStatus && driveStatus !== "off" && driveStatus !== "unconfigured" && (
            <span
              className={`drive-indicator drive-indicator-${driveStatus}`}
              aria-label={`Google Drive: ${driveStatus}`}
            >
              ☁️
            </span>
          )}
        </button>
      </div>
    </nav>
  );
}
