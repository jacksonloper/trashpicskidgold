import { useEffect, useState } from "react";
import { forgetReadings } from "../useReadAloud";

/**
 * The story's spoken side: one button that forgets every reading Gemini has
 * made of its pages, so each is fetched again the next time P asks for it.
 *
 * Readings are cached by the words and the voice, so a page keeps sounding
 * the way it did the first time it was read. That is what makes a replay
 * free, and also what keeps a reading that came out oddly — a mispronounced
 * name, a stumble — coming back. This is the way out.
 *
 * Shown only when Gemini's voice is in use; without it there is nothing
 * cached to forget.
 */
export default function ReadAloudCard({ story, enabled }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  // A note about one story shouldn't linger onto the next.
  const storyId = story?.id;
  useEffect(() => setStatus(null), [storyId]);

  if (!story || !enabled) return null;

  const forget = async () => {
    setBusy(true);
    try {
      const n = await forgetReadings(story.jsonblob?.sections ?? []);
      setStatus(
        n === 0
          ? "No readings of this story were kept."
          : `Forgot ${n} ${n === 1 ? "reading" : "readings"}. Each page is read afresh next time.`
      );
    } catch (e) {
      console.warn("Couldn't forget the readings", e);
      setStatus("Couldn't forget the readings. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card read-aloud-section">
      <h2>🔊 Read aloud</h2>
      <p className="section-description">
        Gemini&apos;s reading of each page is kept so <kbd>P</kbd> replays it
        for free. Forget this story&apos;s readings to have every page read
        afresh — after a page is rewritten, or when a reading came out wrong.
      </p>
      <div className="export-row">
        <button
          type="button"
          className="btn-secondary"
          onClick={forget}
          disabled={busy}
        >
          🗑️ Forget this story&apos;s readings
        </button>
        {status && (
          <span className="read-aloud-status" role="status">
            {status}
          </span>
        )}
      </div>
    </section>
  );
}
