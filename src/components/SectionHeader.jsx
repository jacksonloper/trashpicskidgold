/**
 * The title-and-actions row at the top of the open section.
 *
 * The two arrows reorder the story — they move this section past its
 * neighbour. That was anyone's guess while they were bare ▲/▼ glyphs sitting
 * under a Previous/Next pager, beside an index the arrow keys walk, so they
 * say it in words now; the tooltip names what moves and where it goes.
 *
 * `noun` is what this section is called in that copy: a "page", a "text
 * block".
 */
export default function SectionHeader({
  title,
  noun,
  onMoveUp,
  onMoveDown,
  onRemove,
}) {
  return (
    <div className="section-header">
      <h3>{title}</h3>
      <div className="section-header-actions">
        <button
          type="button"
          className="btn-move"
          onClick={onMoveUp}
          disabled={!onMoveUp}
          title={`Move this ${noun} one place earlier in the story`}
        >
          ▲ Move up
        </button>
        <button
          type="button"
          className="btn-move"
          onClick={onMoveDown}
          disabled={!onMoveDown}
          title={`Move this ${noun} one place later in the story`}
        >
          ▼ Move down
        </button>
        <button
          type="button"
          className="btn-remove"
          onClick={onRemove}
          title={`Remove this ${noun} from the story`}
          aria-label={`Remove this ${noun} from the story`}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
