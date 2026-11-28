/*
 * When the app's bare-key shortcuts (\, P, the arrows, J/K, Home/End) may act.
 *
 * They used to need the keyboard on the section list, which meant they
 * silently did nothing after any click elsewhere — on a button, on the story
 * picker, on blank page. Now they work from anywhere, except:
 *
 *  - while something is being typed into (a caption, a filter box, a select),
 *    where those keys are the user's own;
 *  - while focus is on a control that uses the arrows itself (a listbox, a
 *    slider, a radio group, a media player);
 *  - while anything floats over the page and wants the keyboard: a dialog, the
 *    story picker's panel.
 *
 * The overlay check looks at the DOM rather than at App's state so a new
 * dialog is covered the moment it is marked up like the others, without
 * anyone remembering to add it to a list.
 */

/** Somewhere keys are text. */
export function isTypingTarget(el) {
  if (!el) return false;
  return (
    el.isContentEditable ||
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT"
  );
}

const ARROW_ROLES = new Set([
  "listbox",
  "option",
  "slider",
  "spinbutton",
  "radio",
  "radiogroup",
  "menu",
  "menuitem",
  "tab",
  "tablist",
  "grid",
  "tree",
  "treeitem",
]);

/** A focused control that already does something with the arrow keys. */
function ownsArrowKeys(el) {
  if (!el) return false;
  if (el.tagName === "AUDIO" || el.tagName === "VIDEO") return true;
  const role = el.getAttribute?.("role");
  return !!role && ARROW_ROLES.has(role);
}

/** A dialog, or the story picker, is open over the page. */
export function overlayOpen() {
  return !!document.querySelector(
    '[aria-modal="true"], .plan-modal-overlay, .story-picker-panel'
  );
}

/** The waiting game is up and listening for letters. */
export function lettersTaken() {
  return !!document.querySelector(".waiting-letter:not(.is-away)");
}

/** Whether a bare-key shortcut may act on this event. */
export function shortcutsAvailable(event) {
  const el = event.target;
  return !overlayOpen() && !isTypingTarget(el) && !ownsArrowKeys(el);
}

/** Like shortcutsAvailable, for a shortcut that is a letter. */
export function letterShortcutAvailable(event) {
  return shortcutsAvailable(event) && !lettersTaken();
}
