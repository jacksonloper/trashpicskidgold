export default function Navbar({
  stories,
  activeStoryId,
  onSelectStory,
  onNewStory,
  onDeleteStory,
  onLoadExample,
  loadingExample,
  onImport,
  importing,
}) {
  const handleImportChange = (e) => {
    const files = Array.from(e.target.files ?? []);
    // Reset first, so picking the same file twice still fires a change event.
    e.target.value = "";
    if (files.length) onImport(files);
  };

  return (
    <nav className="navbar">
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

        {activeStoryId && (
          <button
            type="button"
            className="btn-small btn-danger"
            onClick={onDeleteStory}
          >
            🗑️ Delete
          </button>
        )}
      </div>
    </nav>
  );
}
