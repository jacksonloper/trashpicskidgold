# Story Maker

A lightweight React + Vite app for creating illustrated children's stories with AI. An adult works with a kid (who can't type yet) to build a character sheet and generate story page illustrations using the Gemini API.  Live at https://main--trashpicskidgold.netlify.app/

## Features

- **BYOK (Bring Your Own Key)** — paste your Gemini API key; nothing is stored on a server
- **Character Sheet** — define up to 4 characters with names and descriptions, then generate a character model sheet
- **Story Pages** — add illustrated pages with captions; each illustration uses the character sheet as a visual reference for consistency
- **Keyboard-first navigation** — the story index sits down the left on a wide screen; one `Tab` reaches it, then `↑`/`↓` turn pages and land with the illustration fully in view (`Alt`+`↑`/`↓` while you type; hold either to go faster)
- **Export / Import** — download a story as a ZIP and load it back later, on any machine
- **Netlify-ready** — deploys with `netlify.toml` included

## Story bundles

Stories live only in the browser's IndexedDB, so the ZIP that **Export → Download
ZIP** produces is the only backup there is. **Import** in the navbar reads those
same ZIPs back — pick several at once to restore a whole shelf of stories.

The layout (`src/storyBundle.js` is the single source of truth for both
directions):

```
story.json    { formatVersion: 2, id, title, jsonblob }
images.json   [ { id, storyId, caption, characterReferenceId, file } ]
images/…      the image files, named for humans
story.md      convenience rendering — ignored on import
```

`images.json` is what makes a bundle round-trippable: the story refers to
images by id, but the files in `images/` are named after their captions, so
something has to carry the mapping.

Import rules worth knowing:

- **Ids are preserved** when the story isn't already present, so restoring a
  backup restores it exactly.
- **Re-importing a story you already have** brings it in as a copy under fresh
  ids rather than overwriting the one you're working on.
- **References to images the ZIP doesn't contain are dropped**, leaving the
  caption and prompt in place so the panel can just be generated again.
- **Older ZIPs still load.** Bundles exported before Import existed had a bare
  `jsonblob` in `story.json` and no `images.json`; their images are matched back
  by the ordinal prefix in each filename, and the title is read from `story.md`.

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) and paste a [Gemini API key](https://aistudio.google.com/app/apikey) to get started.

## Deploy

Push to a repo connected to Netlify — it will use the included `netlify.toml` to build and deploy automatically.
