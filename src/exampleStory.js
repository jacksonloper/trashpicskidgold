/**
 * Example story data and loader.
 *
 * Pre-generated images live in /example/*.png (served from public/).
 * loadExampleStory() fetches them, converts to data-URLs, and writes
 * everything into IndexedDB, returning the new story id.
 */

import {
  newStoryId,
  newImageId,
  saveStory,
  saveImage,
  DEFAULT_STYLE,
} from "./db";

const CHARACTERS = [
  { name: "Luna", description: "A curious little fox with a fluffy orange tail and big purple eyes, wearing a small blue bandana" },
  { name: "Bramble", description: "A friendly hedgehog wearing tiny round glasses and a cozy green scarf" },
  { name: "Pip", description: "A cheerful bluebird with bright feathers and a tiny red hat" },
];

const SECTIONS = [
  {
    type: "markdown",
    content:
      "# The Lost Star\n\nOnce upon a time, in a cozy forest village nestled between tall oak trees, there lived three best friends: **Luna** the fox, **Bramble** the hedgehog, and **Pip** the bluebird. Every evening they would gather around a little campfire and tell each other stories about the stars.",
  },
  {
    type: "illustration",
    caption:
      "Luna, Bramble, and Pip gathered around a cozy campfire in a forest clearing as a bright shooting star streaks across the night sky",
    imageFile: "illustration-1.png",
  },
  {
    type: "markdown",
    content:
      '"Did you see that?" Luna\'s tail swished with excitement as a brilliant streak of light shot across the sky and disappeared behind the Whispering Hills.\n\n"A falling star!" Bramble pushed his glasses up his nose. "I\'ve read about those. They\'re supposed to grant wishes!"\n\nPip fluttered her wings. "Well, what are we waiting for? Let\'s go find it!"',
  },
  {
    type: "illustration",
    caption:
      "The three friends walking along a moonlit forest path, following a trail of tiny sparkles on the ground",
    imageFile: "illustration-2.png",
  },
  {
    type: "markdown",
    content:
      "They followed the trail of sparkles deep into the forest. The tiny lights twinkled on the ground like breadcrumbs made of moonlight. Luna's sharp eyes spotted each glimmer, Bramble kept careful notes on his little map, and Pip flew ahead to scout the way.\n\n\"We must be getting close,\" whispered Luna. \"The sparkles are getting brighter!\"",
  },
  {
    type: "illustration",
    caption:
      "Luna, Bramble, and Pip discovering a softly glowing golden star nestled in a bed of colorful wildflowers",
    imageFile: "illustration-3.png",
  },
  {
    type: "markdown",
    content:
      'And there, in a meadow full of wildflowers, they found it — a tiny golden star, no bigger than a acorn, glowing softly in the grass.\n\n"Hello, little star," Luna said gently. "Are you lost?"\n\nThe star pulsed warmly, as if to say *yes*.\n\nTogether, the three friends carried the star to the top of the highest hill. Pip held it carefully in her claws and flew as high as she could, and with a gentle toss, the star floated back up into the sky, joining its family with a happy twinkle.\n\n"Make a wish!" Bramble reminded them.\n\nThey all closed their eyes and wished the same thing: *that they would always be best friends.*\n\n**The End** ⭐',
  },
];

/**
 * Fetch a file from public/ and return it as a data-URL string.
 */
async function fetchAsDataUrl(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Create the example story in IndexedDB.
 * Returns { storyId, story } so the caller can update its state.
 */
export async function loadExampleStory() {
  const storyId = newStoryId();

  // -- character sheet image --
  const charSheetDataUrl = await fetchAsDataUrl("/example/character-sheet.png");
  const charSheetImgId = newImageId();
  await saveImage({
    id: charSheetImgId,
    storyId,
    caption: "Character sheet",
    data: charSheetDataUrl,
    characterReferenceId: null,
  });

  // -- sections & illustration images --
  const builtSections = [];
  for (const sec of SECTIONS) {
    if (sec.type === "markdown") {
      builtSections.push({ type: "markdown", content: sec.content });
    } else {
      const dataUrl = await fetchAsDataUrl(`/example/${sec.imageFile}`);
      const imgId = newImageId();
      await saveImage({
        id: imgId,
        storyId,
        caption: sec.caption,
        data: dataUrl,
        characterReferenceId: charSheetImgId,
      });
      builtSections.push({ type: "illustration", caption: sec.caption, imageId: imgId });
    }
  }

  // -- story record --
  const story = {
    id: storyId,
    title: "The Lost Star",
    jsonblob: {
      style: DEFAULT_STYLE,
      referenceGraphics: [
        {
          id: crypto.randomUUID(),
          label: CHARACTERS.map((c) => c.name).join(", ") + " – Character Sheet",
          kind: "character",
          imageId: charSheetImgId,
        },
      ],
      sections: builtSections,
    },
  };
  await saveStory(story);

  return { storyId, story };
}
