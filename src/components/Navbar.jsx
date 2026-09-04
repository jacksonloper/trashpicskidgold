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
          {stories.map((s) => (
            <option key={s.id} value={s.id}>
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
      </div>
    </nav>
  );
}
