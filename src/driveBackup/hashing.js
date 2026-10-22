/**
 * The hashes the backup is checked with. Drive reports a SHA-256 for every
 * binary file it holds, so the app can tell whether what landed is what it
 * sent without ever reading a byte back: hash the local bytes, compare the
 * hex. Pure Web Crypto, no browser-only imports, so this runs under node.
 */

const HEX = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, "0")
);

function toHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += HEX[bytes[i]];
  return out;
}

/** Lower-case hex SHA-256 of a Uint8Array, ArrayBuffer, Blob or string. */
export async function sha256Hex(input) {
  let data;
  if (typeof input === "string") data = new TextEncoder().encode(input);
  else if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) data = input;
  else if (typeof input?.arrayBuffer === "function") data = await input.arrayBuffer();
  else throw new TypeError("sha256Hex: expected bytes, a Blob or a string");
  return toHex(await globalThis.crypto.subtle.digest("SHA-256", data));
}

/**
 * One hash for a whole story folder, from the hashes of its files.
 *
 * Canonical form: every entry becomes the line `<path>\t<sha256>\n` (the
 * relative path inside the story folder, a tab, the lower-case hex hash),
 * the lines are sorted by path with a plain code-point compare, and the
 * SHA-256 of the UTF-8 bytes of the concatenation is the tree hash. The
 * same files in any order give the same hash, and it can be recomputed by
 * anyone holding the folder, which is why it is also written onto the
 * folder as the `storymakerTreeHash` tag.
 *
 * `entries` is an array of { path, sha256 } (or a Map path → sha256).
 */
export function canonicalTree(entries) {
  const list = entries instanceof Map
    ? Array.from(entries, ([path, sha256]) => ({ path, sha256 }))
    : entries;
  return [...list]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((e) => `${e.path}\t${String(e.sha256).toLowerCase()}\n`)
    .join("");
}

export async function treeHash(entries) {
  return sha256Hex(canonicalTree(entries));
}
