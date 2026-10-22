import { wipeDatabase } from "./db";
import { clearStoredToken, signOut } from "./driveBackup/driveClient";
import { clearSettings } from "./settingsStore";
import { clearAgreement } from "./ageGateStore";

/**
 * Leave nothing of the family's behind on this computer.
 *
 * In order: let go of the Google sign-in (revoked at Google, cookie
 * cleared) — but not for long: a parent on library wifi that has just
 * dropped must still get the wipe, so the sign-out is given a few seconds
 * and then left behind (the connections page in the Google account can
 * finish the job). Then empty the database, which also shuts the door on
 * any save still scheduled; forget each store's own key; sweep whatever
 * else carries the app's prefix; and reload, so no story is left in memory.
 *
 * The age-gate agreement goes too, so the next person sees the entrance.
 */
export const FORGET_PHRASE = "forget everything on this computer";

const SIGN_OUT_PATIENCE_MS = 5000;

export async function forgetThisComputer() {
  await Promise.race([
    signOut().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, SIGN_OUT_PATIENCE_MS)),
  ]);
  clearStoredToken();
  try {
    await wipeDatabase();
  } catch (e) {
    console.error("wipe failed", e);
  }
  clearSettings();
  clearAgreement();
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
