/*
 * The pictures for the "first letter" game.
 *
 * Each one is an emoji a four-year-old can name, and the names it might be
 * given. The first name is the one we'd say out loud; the rest are other words
 * a kid could reasonably call the same picture, and their first letters are
 * accepted too — a 🐶 answered with P for "puppy" is a right answer, not a
 * lesson in vocabulary.
 */
const PICTURES = [
  ["🍎", "apple"],
  ["🐜", "ant"],
  ["🐻", "bear"],
  ["🍌", "banana"],
  ["🦋", "butterfly"],
  ["🐱", "cat", "kitty", "kitten"],
  ["🐄", "cow"],
  ["🚗", "car"],
  ["🍪", "cookie"],
  ["🐶", "dog", "puppy"],
  ["🦆", "duck"],
  ["🦕", "dinosaur", "dino"],
  ["🐘", "elephant"],
  ["🥚", "egg"],
  ["🐟", "fish"],
  ["🐸", "frog"],
  ["🔥", "fire"],
  ["🦒", "giraffe"],
  ["🍇", "grapes"],
  ["👻", "ghost"],
  ["🐴", "horse"],
  ["🎩", "hat"],
  ["🏠", "house", "home"],
  ["🍦", "ice cream"],
  ["🧃", "juice"],
  ["🪁", "kite"],
  ["🔑", "key"],
  ["🦁", "lion"],
  ["🍋", "lemon"],
  ["🌙", "moon"],
  ["🐵", "monkey"],
  ["🐭", "mouse"],
  ["👃", "nose"],
  ["🦉", "owl"],
  ["🐙", "octopus"],
  ["🐷", "pig", "piggy"],
  ["🍕", "pizza"],
  ["🐧", "penguin"],
  ["🐰", "rabbit", "bunny"],
  ["🌈", "rainbow"],
  ["🚀", "rocket"],
  ["☀️", "sun"],
  ["🐍", "snake"],
  ["⭐", "star"],
  ["🐢", "turtle", "tortoise"],
  ["🌳", "tree"],
  ["🚂", "train"],
  ["🦄", "unicorn"],
  ["☂️", "umbrella"],
  ["🎻", "violin"],
  ["🐋", "whale"],
  ["🍉", "watermelon"],
  ["🐺", "wolf"],
  ["🩻", "x-ray"],
  ["🧶", "yarn"],
  ["🦓", "zebra"],
];

/*
 * The pictures for the "last letter" game, which is a different list on
 * purpose. A first letter is nearly always the first sound; a last letter
 * very often isn't. Nobody should have to explain to a four-year-old why the
 * end of "dough" is an H, the end of "cake" an E, or the end of "puppy" a Y
 * that says "ee". So every name here ends on a letter you can hear: say the
 * word slowly and the last sound is that letter's own sound.
 *
 * A few vowels make it in where the vowel says its own name — the O at the
 * end of "hippo" is the O you'd sing in the alphabet song.
 *
 * One name each, and no second answers: the game spells the name out under
 * the picture with only its last letter missing, so a 🐱 is a C-A-_ and a
 * kitten would be a different word entirely.
 */
const LAST_LETTER_PICTURES = [
  ["🐱", "cat"],
  ["🐶", "dog"],
  ["🐷", "pig"],
  ["🦊", "fox"],
  ["🦁", "lion"],
  ["🐸", "frog"],
  ["🦆", "duck"],
  ["🐜", "ant"],
  ["🦉", "owl"],
  ["🐛", "bug"],
  ["🐞", "ladybug"],
  ["🐐", "goat"],
  ["🐔", "chicken"],
  ["🦀", "crab"],
  ["🐙", "octopus"],
  ["🦈", "shark"],
  ["🦇", "bat"],
  ["🐑", "sheep"],
  ["🐫", "camel"],
  ["🐘", "elephant"],
  ["🐌", "snail"],
  ["🐧", "penguin"],
  ["🦜", "parrot"],
  ["🐦", "bird"],
  ["🐰", "rabbit"],
  ["🦛", "hippo"],
  ["🦩", "flamingo"],
  ["☀️", "sun"],
  ["🌙", "moon"],
  ["☁️", "cloud"],
  ["🚌", "bus"],
  ["🚂", "train"],
  ["🚀", "rocket"],
  ["⛵", "boat"],
  ["🎩", "hat"],
  ["👢", "boot"],
  ["🎈", "balloon"],
  ["🥁", "drum"],
  ["🔔", "bell"],
  ["⚽", "ball"],
  ["📚", "book"],
  ["✏️", "pencil"],
  ["🛏️", "bed"],
  ["⏰", "clock"],
  ["🎁", "present"],
  ["👑", "crown"],
  ["💎", "diamond"],
  ["🪣", "bucket"],
  ["🧲", "magnet"],
  ["🎹", "piano"],
  ["🎺", "trumpet"],
  ["✋", "hand"],
  ["🦶", "foot"],
  ["🍋", "lemon"],
  ["🍉", "watermelon"],
  ["🌽", "corn"],
  ["🥕", "carrot"],
  ["🍞", "bread"],
  ["🥚", "egg"],
  ["🥜", "peanut"],
  ["🍄", "mushroom"],
  ["🥛", "milk"],
  ["🌮", "taco"],
  ["🌵", "cactus"],
];

/*
 * The endings that betray the rule above, checked rather than trusted, so the
 * next word added to the list can't quietly bring "dough" back:
 *
 * - E is almost always silent (cake, house) or says "ee" (bee).
 * - H only ends a word as half of a pair — sh, ch, th, gh — never as itself.
 * - Y and W are vowels in disguise at the end (puppy, cow, rainbow).
 * - R melts into the vowel before it, and vanishes in half the world's accents.
 * - A at the end is an "uh" (pizza, zebra), not an A.
 * - mb, ng and silent-k pairs: the last letter isn't heard (lamb, king).
 * - Anything that isn't a plain letter (ice cream, x-ray).
 */
function endsOnItsOwnSound(word) {
  if (!/^[a-z]+$/.test(word)) return false;
  if (/[ehwyra]$/.test(word)) return false;
  if (/(mb|ng|gn|kn)$/.test(word)) return false;
  return true;
}

/**
 * The pictures, with the letters each one will take as an answer. A picture
 * with one name has one answer; the last-letter list is all one-name pictures,
 * so there the spelled-out name and the accepted letter can never disagree.
 */
function withAnswers(pictures, letterOf) {
  return pictures.flatMap(([emoji, ...names]) => {
    const words = names.filter((w) => letterOf(w));
    if (words.length === 0) return [];
    return [
      {
        emoji,
        word: words[0],
        answers: [...new Set(words.map((w) => letterOf(w).toUpperCase()))],
      },
    ];
  });
}

const WAITING_PICTURES = withAnswers(PICTURES, (w) => w[0]);

/** Same shape, but the answer is the letter each name ends on. */
export const LAST_LETTER_WAITING_PICTURES = withAnswers(
  LAST_LETTER_PICTURES,
  (w) => (endsOnItsOwnSound(w) ? w[w.length - 1] : null)
);

export default WAITING_PICTURES;
