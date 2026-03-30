export default function Navbar({
  stories,
  activeStoryId,
  onSelectStory,
  onNewStory,
  onDeleteStory,
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
