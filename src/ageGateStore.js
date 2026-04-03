const STORAGE_KEY = "storymaker_age_agreed";
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Check whether the user agreed recently enough. */
export function hasRecentAgreement() {
  try {
    const ts = localStorage.getItem(STORAGE_KEY);
    if (!ts) return false;
    return Date.now() - Number(ts) < EXPIRY_MS;
  } catch {
    return false;
  }
}

export function recordAgreement() {
  try {
    localStorage.setItem(STORAGE_KEY, String(Date.now()));
  } catch {
    /* localStorage unavailable – proceed anyway */
  }
}
