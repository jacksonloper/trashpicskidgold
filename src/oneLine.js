/**
 * A caption is one line of text, however many lines it takes to show.
 *
 * It goes into the image prompt, the index row, the exported file name and the
 * `![…]()` in story.md — all of which want a single line — so a pasted-in line
 * break becomes a space rather than something that has to be handled in four
 * places later. Page captions and reference captions both go through here.
 */
export default function oneLine(text) {
  return text.replace(/\s*\n\s*/g, " ");
}
