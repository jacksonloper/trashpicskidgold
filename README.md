# Story Maker

A lightweight React + Vite app for creating illustrated children's stories with AI. An adult works with a kid (who can't type yet) to build a character sheet and generate story page illustrations using the Gemini API.  Live at https://main--trashpicskidgold.netlify.app/

## Features

- **BYOK (Bring Your Own Key)** — paste your Gemini API key; nothing is stored on a server
- **Character Sheet** — define up to 4 characters with names and descriptions, then generate a character model sheet
- **Story Pages** — add illustrated pages with captions; each illustration uses the character sheet as a visual reference for consistency
- **Keyboard-first navigation** — the story index sits down the left on a wide screen; `\` (or one `Tab`) reaches it, then `↑`/`↓` turn pages and land with the illustration fully in view (`Alt`+`↑`/`↓` while you type; hold either to go faster)
- **Read it to me** — with the keyboard on the story index, `P` reads the page aloud with the browser's own text-to-speech: an illustration's caption, or the words of a text block. Turning the page cuts it off mid-sentence, so the voice never lags behind the picture
- **Pictures fit the window** — an illustration is scaled down to what is left of the window under the navbar, never cropped, so the whole of it is on screen at once; a phone-width window keeps the full-width picture instead
- **Something to do while it draws** — a letter appears in the middle of the window for as long as the wait lasts; type it and it poofs, and another takes its place
- **Failures that explain themselves** — when a picture doesn't arrive, the red banner says what happened in one line and **What happened?** opens the reply behind it: which filter stopped it, what Gemini wrote instead, what to try
- **Trash bin** — a picture removed from a story is never destroyed on the spot; it waits in the trash until you empty it yourself, and any page can pull one back out
- **Stories that stay put** — the app asks the browser to keep its storage *persistent*, so stories and pictures aren't evicted when the disk runs low; only clearing the site's data removes them (Safari may still clear a site that isn't on the Home Screen, so export what matters)
- **Export / Import** — download a story as a ZIP and load it back later, on any machine
- **Google Drive backup** — optional and write-only: every few minutes whatever changed is written to a *trashpicskidgold* folder in your Drive, laid out so a story's folder zips straight back into Import, with each picture sent once and every version of the words kept
- **Netlify-ready** — deploys with `netlify.toml` included

## The waiting letter

A picture takes half a minute or more to come back, which is forever to the kid
who asked for it. So while it is being made, a letter appears in the middle of
the window. Find it on the keyboard and it poofs in a burst of colour, and
another one takes its place. It keeps a count of how many have been found, and
the last one poofs away the moment the picture lands.

It does not cover the page, which is the point: there is no panel and no dimmed
backdrop, nothing on it takes a click except the ✕, and the story, the buttons
and the picture arriving are all still there to be read, pressed and watched.
On a phone, where there is no keyboard to type on, tapping the letter is the
answer instead — and a finger dragged across it still scrolls the page.

- **Wrong keys cost nothing.** The letter shakes its head and waits. Nothing is
  ever taken away from the player, because the player is four.
- **The grown-up's keyboard stays theirs.** With the caret in a caption or any
  other text box the game stops listening entirely: a letter typed there is a
  letter in the caption, never a guess.
- **`Esc` or the ✕** puts it away until the next picture, and it stands aside on
  its own for anything that wants an answer — the plan review, a confirmation,
  the trash.

### Or a picture instead

**⚙️ Settings** in the navbar picks which game the wait plays:

- **Find the letter** — the game above.
- **First letter of the picture** — a picture appears instead: a dog, a cat, an
  apple. Type the letter its name starts with — `D` for the dog, `C` for the
  cat. A picture that could be called two things takes either first letter (a
  🐶 answered with `P` for puppy is right), and after two misses the little
  line underneath whispers its name. On a phone, three letters to tap appear
  under the picture, one of them right.
- **Last letter of the picture** — the same, from the other end: `G` for the
  dog, `T` for the cat. So that nobody mistakes it for the first-letter game,
  a caterpillar under the picture spells the name out, head first, one letter
  to a segment — `D`, `O`, and a hollow tail segment with a `?` in it. The
  whole word is on show from the start, so there is nothing to whisper after
  two misses, and the only right answer is the letter that fills the tail:
  a 🐱 is `C`-`A`-`?`, never a kitten. Three wrong guesses is a miss: a red
  ring lands around the picture, the tail fills in red with the answer, no
  star, and the next picture comes along. A right answer gets the same
  ring in gold, with a few stars twinkling round it. It draws from its own list of pictures,
  because a last letter is so often not the last sound — nobody wants to
  explain why "dough" ends in an H. Every name on it ends on a letter you can
  hear, and `src/waitingPictures.js` checks that rather than trusting it: a
  name ending in a silent E, a Y or W that's really a vowel, an R, an "uh" A,
  or a pair like `gh`, `sh` or `ng` is dropped from the game, even if someone
  adds it.

The choice is remembered in the browser. Switching mid-wait deals a fresh
target for the new game. **▶ Free play** in the same dialog starts the chosen
game on the spot, with nothing being made, for trying it out at length; `Esc`
or the ✕ ends it.

## When a picture doesn't arrive

Half the time a generation fails, Gemini has already said exactly why — and
none of it used to reach the screen. A refused prompt, a model that ran out of
room, a picture that was drawn and then held back, and a key that has run out of
quota all arrived as one flat line at the bottom of the window, and the times
they didn't, they arrived as three hundred characters of raw JSON across it.

Now the banner keeps one readable line and **What happened?** opens the rest:

- **What happened**, in a sentence — "Gemini drew something and then its safety
  filter held the picture back", not `finishReason: IMAGE_SAFETY`.
- **The facts**: the model, the finish reason, the request block reason, any
  safety category that was actually flagged, the tokens spent.
- **What Gemini wrote instead**, when it answered in words. A refusal usually
  arrives as a polite paragraph where the picture should have been, and it
  generally names the problem.
- **What to try** — reword the caption, switch models, wait a minute, check the
  key — chosen for the failure that actually happened rather than listed in
  general.
- **The whole reply**, folded away, with the base64 taken out so it can be read,
  and a button that copies it.

Nothing here can change a story: the dialog is safe to open mid-generation, the
waiting letter stands aside for it like any other dialog, and `Esc` closes it.

The detail rides along on the error itself (`GeminiError` in `src/gemini.js`),
so a failure that has nothing more to say simply doesn't offer the button — a
file that wouldn't open is already its own explanation.

## The trash

Every picture costs an API call and a few minutes of a kid's patience, so
nothing in the app deletes one outright. Whenever a picture leaves a story it
goes to the trash instead:

| What you did | What the trash says |
| --- | --- |
| Removed a page that had an illustration | *its page was removed* |
| Removed a reference graphic | *its reference graphic was removed* |
| Deleted a whole story | *its story was deleted* |
| Generated or uploaded over an existing picture | *it was replaced by a new generation* |

That last one is the quiet one — re-generating a page used to lose the previous
illustration with no dialog and no toast.

**🗑️ Trash** in the navbar opens the bin, with a count of what is waiting in it.
Each picture shows its caption, which story it came from, why it was thrown
away, and how big it is. From there you can **Save** one to your computer, or
destroy it — **Delete forever** and **Empty trash** are the only two things in
the app that actually get rid of a picture, and both ask first. Emptying wants
you to type `empty`.

Getting a picture back happens on the page that wants it, not in the bin. Under
the two generate buttons every illustration page carries a pair of small,
deliberately quiet ones:

- **📁 Upload illustration** — put a picture from your own computer on this
  page. No API call, no waiting.
- **🗑️ Take illustration from trash** — opens the same bin as a picker, showing
  how many pictures are in it, and drops the one you choose onto this page.
  Greyed out while the trash is empty.

Either one is a straight swap: whatever was on the page takes the incoming
picture's place in the trash, so nothing is lost by changing your mind. A
picture can land on a page in a different story than the one it came from —
it is re-stamped as that story's on the way out, so deleting its old story
later leaves it alone.

Nothing here expires: the trash survives reloads and sits there until you clear
it. The undo toast still works exactly as before — undoing a removal quietly
takes the picture back out of the trash — and emptying the trash closes any undo
offer still on screen, since there would be nothing left to put back.

The trash is not part of an exported ZIP. Take a picture back onto a page
first if you want it in the bundle.

## Story bundles

Stories live only in the browser's IndexedDB, so the ZIP that **Export → Download
ZIP** produces is the backup you hold in your hand (the Google Drive backup
below is the other). **Import** in the navbar reads those
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

## Google Drive backup

Stories live in the browser's IndexedDB, and the ZIP that Export produces was
the only backup there was. **⚙️ Settings → Connect Google Drive** adds
another: every few minutes, whatever has changed is written to a
*trashpicskidgold* folder in the grown-up's Google Drive. Drive is only ever written to.
Nothing is read back, so no backup can change, overwrite or remove a story
in the browser, and there is no sync to reason about.

Each story is a folder laid out like an Export ZIP, unpacked:

```
trashpicskidgold/
  the-dog/
    story.json      { formatVersion, id, title, jsonblob }
    images.json     [ { id, storyId, caption, characterReferenceId, file } ]
    images/
      A_dog_1a2b3c4d.png …
    history/
      2026-10-22T01-02-03Z.json …
```

That layout is the point. **To restore a story, download its folder from
Drive as a ZIP and hand it to Import**: `story.json` and `images.json` are
what Import reads (`src/storyBundle.js` is still the one definition of the
format), and `history/` it ignores. Import looks through the single wrapping
directory Drive puts in a folder download.

The folder differs from a ZIP in two ways, both deliberate:

- **Each picture is sent once.** A picture never changes once it has an id,
  so the backup uploads only the ones Drive does not already hold. Adding an
  illustration to a seventy-page story sends one picture and two small JSON
  files, not the other sixty-nine pictures.
- **Every version of the words is kept.** Each upload first drops the story's
  text into `history/` under the time it was saved, and those files are never
  overwritten. The text is small (pictures are by id), so keeping all of it
  costs nothing, and a page a child dictated last month can still be read
  after it was rewritten. `story.json` is always the latest.

Each story carries an `updatedAt` stamp, restamped on every save and never
moved backwards, and a `backup` store in IndexedDB remembers, per story, the
stamp as of its last upload and where its folder and files are on Drive. A
story whose stamp has moved goes up again; `story.json` is written last, so a
folder that has one is a complete bundle. Deleting a story here leaves its
folder on Drive alone — that is what a backup is for. Connecting forgets the
bookkeeping, but every story folder on Drive is tagged with the story's
permanent id and this browser's, so a reconnect finds each story's folder
again and sends up only what it lacks; a different Google account, having
none, gets everything. The browser's id is there because Import preserves
story ids: the same ZIP restored into two browsers would otherwise back up
into one folder, each overwriting the other's `story.json`. With it, they get
`the-lost-star` and `the-lost-star-2`.
Pictures over a few megabytes go up by Drive's resumable protocol. The trash
is not backed up, and neither is the API key.

Once connected, the open tab backs up every three minutes, whenever it is
hidden, and on **Back up now**. Nothing in the kid's half of the app changes:
no dialog, no spinner, just a small ☁️ beside Settings that goes amber when
Google wants a grown-up to sign in again.

### One tab at a time

Stories are kept in the browser, and two tabs of the app would each hold
their own copy of the open story, the later autosave winning, and would each
run their own backups. So the app runs in one tab: the first takes a browser
lock (`src/useSingleTab.js`, the Web Locks API, mounted from `src/Root.jsx`)
and keeps it until it closes, and any other tab is shown a notice instead of
the app, with a **Use this tab instead** button that takes the lock over and
puts the first tab behind the same notice. The app is never mounted in a tab
standing aside, so no timer of any kind runs there.

### Setting it up

The app uses the `drive.file` scope: it can only see files it created itself.
Google classes that as non-sensitive, so there is no verification review, and
no API key — only an OAuth client id.

1. In [Google Cloud Console](https://console.cloud.google.com/) create a
   project (or pick one) and enable the **Google Drive API**
   (*APIs & Services → Library*).
2. *APIs & Services → OAuth consent screen*: external, give it a name and your
   email. Add the scope `…/auth/drive.file`. Either add yourself (and the
   other grown-ups) as **test users**, or **Publish** the app — with only
   non-sensitive scopes, publishing needs no review.
3. *APIs & Services → Credentials → Create credentials → OAuth client ID*,
   type **Web application**. Under *Authorised JavaScript origins* add every
   origin the app is served from, e.g. `http://localhost:5173` and
   `https://main--trashpicskidgold.netlify.app`. No redirect URIs are needed.
4. Put the client id in `VITE_GOOGLE_CLIENT_ID`: in `.env.local` for
   development (see `.env.example`), and on Netlify under *Site configuration
   → Environment variables*, then redeploy.

Without that variable the Drive section of Settings explains that backup is
not set up on this build, and everything else works as before.

### Staying signed in for longer than an hour

On its own, a browser can only get hour-long tokens from Google, and only
through a popup a person clicked for. So without more, the cloud goes amber
an hour into a long session and a grown-up presses **Sign in and back up**
once; nothing is lost in between, the next backup catches up.

To make that go away, the site can keep the sign-in alive itself. The
Netlify function in `netlify/functions/drive-auth.mjs` holds the OAuth
client secret, which a browser never may. Google's popup hands the browser a
one-time code; the function trades it for a refresh token, keeps that in an
encrypted, HttpOnly cookie on this site (the browser's JavaScript never sees
it), and from then on mints a fresh access token whenever the app asks: no
popup, no click, for months. No story, picture or word passes through the
function, only Google's tokens.

To turn it on, set three more variables on Netlify and redeploy:

| Variable | What |
| --- | --- |
| `VITE_DRIVE_SERVER_AUTH` | `1` — tells the build to use the function |
| `GOOGLE_CLIENT_SECRET` | the client secret from the same OAuth client (never `VITE_`) |
| `DRIVE_COOKIE_SECRET` | any long random string, e.g. `openssl rand -base64 48` |

Nothing changes in Cloud Console: the code arrives through the popup, not a
redirect, so no redirect URI is needed. One thing does matter there: an OAuth
consent screen still **in testing** expires its refresh tokens after seven
days, so **publish** it (with only the `drive.file` scope, that needs no
review). Locally, `netlify dev` serves the function alongside Vite; plain
`npm run dev` has no function, so leave `VITE_DRIVE_SERVER_AUTH` unset there
and the hourly popup model is used instead.

**Disconnect** in Settings asks the function to revoke the refresh token and
clear the cookie, so the sign-in is gone from Google's side too.

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) and paste a [Gemini API key](https://aistudio.google.com/app/apikey) to get started.

## Deploy

Push to a repo connected to Netlify — it will use the included `netlify.toml` to build and deploy automatically.
