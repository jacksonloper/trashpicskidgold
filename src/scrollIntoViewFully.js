/*
 * Scrolling that shows a whole thing.
 *
 * `Element.scrollIntoView` aligns one edge and always moves; turning a story
 * page wants the opposite: put the picture *entirely* on screen, and leave the
 * view alone when it already is.
 */

/**
 * Scroll the window the shortest distance that puts `el` fully in view.
 *
 * `topInset` is how much of the top of the viewport the sticky navbar covers —
 * that band is on screen but not visible. Anything taller than what is left is
 * aligned to the top of that band, since it cannot fit either way.
 *
 * Returns true when the view actually moved.
 */
export default function scrollIntoViewFully(
  el,
  { topInset = 0, behavior = "auto" } = {}
) {
  if (!el) return false;

  const rect = el.getBoundingClientRect();
  const viewTop = topInset;
  const viewBottom = window.innerHeight;
  const room = viewBottom - viewTop;

  let delta;
  if (rect.height >= room || rect.top < viewTop) {
    delta = rect.top - viewTop; // too tall to fit, or hanging off the top
  } else if (rect.bottom > viewBottom) {
    delta = rect.bottom - viewBottom; // hanging off the bottom: pull up
  } else {
    return false; // all of it is already visible
  }

  if (Math.abs(delta) < 1) return false;
  window.scrollBy({ top: delta, behavior });
  return true;
}
