import { SPEECH_VOICES } from "../gemini";
import { DEFAULT_VOICE_ACTING } from "../voiceActingStore";

/**
 * Everything Gemini is told when it voice-acts this story: which voice, and
 * the direction read to it before the words of each page.
 *
 * The page's words follow the direction after a blank line, so the
 * direction can be anything the reader should know: who is listening, the
 * pace, the mood, how each character sounds. Kept on this computer only,
 * like the readings — not part of the story, never exported or backed up.
 */
export default function VoiceActingEditor({ acting, onChange, disabled }) {
  const isDefault =
    acting.voice === DEFAULT_VOICE_ACTING.voice &&
    acting.direction === DEFAULT_VOICE_ACTING.direction;
  return (
    <section className="card">
      <h2>🎙️ Voice Acting</h2>
      <p className="section-description">
        How Gemini reads each page aloud. The direction is sent first, then a
        blank line, then the page&apos;s words. Change either and every page is
        read afresh the next time it is heard; <strong>🎙️ Remake voice</strong>{" "}
        on a page redoes just that one. Kept on this computer only — not part
        of the story, never exported or backed up.
      </p>
      {disabled && (
        <p className="confirm-note">
          Gemini&apos;s voice is off in ⚙️ Settings, so <kbd>P</kbd> uses the
          browser&apos;s voice and none of this is used.
        </p>
      )}
      <label className="voice-acting-row">
        <span className="plan-label">Voice</span>
        <select
          value={acting.voice}
          onChange={(e) => onChange({ ...acting, voice: e.target.value })}
        >
          {SPEECH_VOICES.map((v) => (
            <option key={v.name} value={v.name}>
              {v.name} — {v.feel}
            </option>
          ))}
        </select>
      </label>
      <label className="voice-acting-row voice-acting-direction">
        <span className="plan-label">Direction</span>
        <textarea
          className="markdown-input style-input"
          rows={5}
          value={acting.direction}
          onChange={(e) => onChange({ ...acting, direction: e.target.value })}
          placeholder="e.g. Read this like a grown-up reading a picture book to a seven-year-old. Mouse squeaks; Bear rumbles slowly…"
        />
      </label>
      <button
        type="button"
        className="btn-small"
        disabled={isDefault}
        onClick={() => onChange({ ...DEFAULT_VOICE_ACTING })}
      >
        Back to the default
      </button>
    </section>
  );
}
