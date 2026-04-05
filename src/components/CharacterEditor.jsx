const MAX_CHARACTERS = 4;

const emptyChar = () => ({ name: "", description: "" });

export default function CharacterEditor({
  characters,
  onCharactersChange,
}) {
  const addCharacter = () => {
    if (characters.length < MAX_CHARACTERS) {
      onCharactersChange([...characters, emptyChar()]);
    }
  };

  const removeCharacter = (idx) => {
    onCharactersChange(characters.filter((_, i) => i !== idx));
  };

  const updateCharacter = (idx, field, value) => {
    const updated = characters.map((c, i) =>
      i === idx ? { ...c, [field]: value } : c
    );
    onCharactersChange(updated);
  };

  return (
    <section className="card">
      <h2>📝 Characters</h2>
      <p className="section-description">
        Define up to {MAX_CHARACTERS} characters for your story. Give each a
        name and a fun description.
      </p>

      {characters.map((char, idx) => (
        <div key={idx} className="character-row">
          <input
            className="char-name"
            type="text"
            placeholder="Name"
            value={char.name}
            onChange={(e) => updateCharacter(idx, "name", e.target.value)}
          />
          <input
            className="char-desc"
            type="text"
            placeholder="Description (e.g. a small round potato with a pug face)"
            value={char.description}
            onChange={(e) =>
              updateCharacter(idx, "description", e.target.value)
            }
          />
          <button
            type="button"
            className="btn-remove"
            onClick={() => removeCharacter(idx)}
            title="Remove character"
          >
            ✕
          </button>
        </div>
      ))}

      {characters.length < MAX_CHARACTERS && (
        <button type="button" className="btn-secondary" onClick={addCharacter}>
          + Add Character
        </button>
      )}
    </section>
  );
}
