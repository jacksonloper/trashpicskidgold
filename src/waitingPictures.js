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

/** The pictures, with the letters each one will take as an answer. */
const WAITING_PICTURES = PICTURES.map(([emoji, ...words]) => ({
  emoji,
  word: words[0],
  answers: [...new Set(words.map((w) => w[0].toUpperCase()))],
}));

export default WAITING_PICTURES;
