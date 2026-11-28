import { useEffect, useMemo, useRef, useState } from "react";
import { letterShortcutAvailable } from "../keyboardScope";

/*
 * The story chooser.
 *
 * A native <select> was fine for a handful of stories and gets worse with every
 * one added: a list taller than the window, in whatever order they were made,
 * with no way to jump to the one you want. This is a button that opens a
 * panel with a filter box and the stories in alphabetical order. The list is
 * capped in height and scrolls inside itself, so however long the shelf gets
 * it never runs off the window.
 */

const collator = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

export default function StoryPicker({ stories, activeStoryId, onSelect, glyphFor }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const sorted = useMemo(
    () =>
      [...stories].sort((a, b) =>
        collator.compare(a.title || "Untitled", b.title || "Untitled")
      ),
    [stories]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((s) => (s.title || "Untitled").toLowerCase().includes(q));
  }, [sorted, query]);

  const active = stories.find((s) => s.id === activeStoryId);

  function openPanel() {
    setQuery("");
    const i = sorted.findIndex((s) => s.id === activeStoryId);
    setHighlight(i < 0 ? 0 : i);
    setOpen(true);
  }

  function choose(story) {
    setOpen(false);
    if (story && story.id !== activeStoryId) onSelect(story.id);
  }

  // Focus the filter box on open, and bring the current story into view.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector(`[data-index="${highlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, highlight, filtered]);

  // S opens it from anywhere — unless typing, a dialog is up, or the waiting
  // game is listening for letters (see keyboardScope).
  const openRef = useRef(openPanel);
  useEffect(() => {
    openRef.current = openPanel;
  });
  const canOpen = stories.length > 0;
  useEffect(() => {
    if (open || !canOpen) return undefined;
    const onKeyDown = (e) => {
      if (
        (e.key === "s" || e.key === "S") &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.repeat &&
        letterShortcutAvailable(e)
      ) {
        e.preventDefault(); // or the S lands in the filter box
        openRef.current();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, canOpen]);

  // A click anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function onKeyDown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setHighlight(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setHighlight(filtered.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(filtered[highlight]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  }

  const label = active
    ? `${glyphFor(active)}${active.title || "Untitled"}`
    : stories.length === 0
      ? "No stories yet"
      : "Choose a story…";

  return (
    <div className="story-picker" ref={rootRef}>
      <button
        type="button"
        className="story-select story-picker-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={stories.length === 0}
        onClick={() => (open ? setOpen(false) : openPanel())}
        title={`${active ? active.title || "Untitled" : "Choose a story"} (S)`}
      >
        <span className="story-picker-label">{label}</span>
        <span className="story-picker-caret" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="story-picker-panel">
          <input
            ref={inputRef}
            type="text"
            className="story-picker-filter"
            placeholder={`Find a story (${stories.length})…`}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
            }}
            onKeyDown={onKeyDown}
            aria-label="Filter stories"
          />
          <ul className="story-picker-list" role="listbox" ref={listRef}>
            {filtered.length === 0 && (
              <li className="story-picker-empty">No matching stories</li>
            )}
            {filtered.map((s, i) => (
              <li
                key={s.id}
                data-index={i}
                role="option"
                aria-selected={s.id === activeStoryId}
                className={
                  "story-picker-option" +
                  (i === highlight ? " is-highlighted" : "") +
                  (s.id === activeStoryId ? " is-current" : "")
                }
                onMouseEnter={() => setHighlight(i)}
                onClick={() => choose(s)}
              >
                {glyphFor(s)}
                {s.title || "Untitled"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
