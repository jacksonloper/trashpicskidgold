export default function Navbar({
  stories,
  activeStoryId,
  onSelectStory,
  onNewStory,
  onDeleteStory,
  onLoadExample,
  loadingExample,
}) {
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
