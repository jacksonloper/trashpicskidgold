import { useState } from "react";
import { remakeReading, spokenText, useHasReading } from "../useReadAloud";

/**
 * Make, or make again, Gemini's reading of the page on screen with the
 * story's current voice acting, and play it when it lands. The reading is
 * kept on this computer in place of any earlier take.
 */
export default function VoiceButton({ section, apiKey, acting, voiceOff }) {
  const [busyFor, setBusyFor] = useState(null); // section id being voiced
  const [failure, setFailure] = useState(null); // { id, message }
  const has = useHasReading(section, acting);
  const words = spokenText(section);
  const busy = busyFor === section.id;

  const why = voiceOff
    ? "Gemini's voice is off in Settings"
    : !apiKey?.trim()
      ? "Needs a Gemini API key"
      : !words
        ? "This page has no words to read yet"
        : null;

  const handleClick = async () => {
    const id = section.id;
    setBusyFor(id);
    setFailure(null);
    try {
      await remakeReading(apiKey, section, acting);
    } catch (e) {
      setFailure({ id, message: e?.message ?? String(e) });
    } finally {
      setBusyFor((cur) => (cur === id ? null : cur));
    }
  };

  return (
    <span className="voice-button">
      <button
        type="button"
        className="btn-small"
        onClick={handleClick}
        disabled={!!why || busy}
        title={
          why ??
          (has
            ? "Have Gemini read this page again with the current voice acting, replacing the take kept now"
            : "Have Gemini read this page with the current voice acting, and keep it")
        }
      >
        {busy ? "🎙️ Voicing…" : has ? "🎙️ Remake voice" : "🎙️ Make voice"}
      </button>
      {failure?.id === section.id && (
        <span className="voice-button-error" role="alert" title={failure.message}>
          Didn&apos;t work: {failure.message}
        </span>
      )}
    </span>
  );
}
