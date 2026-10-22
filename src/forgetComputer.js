import { wipeDatabase } from "./db";
import { signOut } from "./driveBackup/driveClient";

/**
 * Leave nothing of the family's behind on this computer.
 *
 * In order: let go of the Google sign-in (revoked at Google, cookie
 * cleared), empty the database, drop every localStorage and sessionStorage
 * key the app owns, then reload so no story is left in memory either. Each
 * step is best effort: a sign-out that fails must not stop the wipe.
 *
 * The one thing deliberately left is nothing: the age-gate agreement goes
 * too, so the next person sees the entrance page.
 */
export const FORGET_PHRASE = "forget everything on this computer";

export async function forgetThisComputer() {
  try {
    await signOut();
  } catch {
    /* the cookie may already be gone; carry on */
  }
  try {
    await wipeDatabase();
  } catch (e) {
    console.error("wipe failed", e);
  }
  for (const store of [localStorage, sessionStorage]) {
    try {
      const ours = [];
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        if (key && key.startsWith("storymaker")) ours.push(key);
      }
      for (const key of ours) store.removeItem(key);
    } catch {
      /* storage unavailable */
    }
  }
  window.location.reload();
}
