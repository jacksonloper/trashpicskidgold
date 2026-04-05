export default function StyleEditor({ style, onStyleChange }) {
  return (
    <section className="card">
      <h2>🎨 Illustration Style</h2>
      <p className="section-description">
        Describe the visual style for all illustrations. This text is prepended
        to every image-generation prompt to keep a consistent look.
      </p>
      <textarea
        className="markdown-input style-input"
        rows={4}
        value={style}
        onChange={(e) => onStyleChange(e.target.value)}
        placeholder="e.g. Children's book illustration in a warm, whimsical watercolor style…"
      />
    </section>
  );
}
