import { useCallback, useEffect, useRef, useState } from "react";
import { CLIENT_ID, getAccessToken, hasToken, signOut } from "./driveClient";
import { loadDriveConfig, saveDriveConfig, runSync } from "./runSync";

/** How often a quiet, open tab checks in with Drive. */
const INTERVAL_MS = 3 * 60 * 1000;

/**
 * Drive sync as the app sees it: a status, a few buttons, and a timer.
 *
 * Statuses:
 *   unconfigured  no client id was built in — the section explains how
 *   off           set up, but the grown-up has not connected it
 *   idle          connected; nothing happening
 *   syncing       a sync is in flight
 *   signin        connected, but Google wants a click before the next sync
 *   error         the last sync failed; `error` says how
 *
 * `flushSave` is awaited before each sync so the newest keystroke is in the
 * database, `isDirty` holds a download back from the story being typed in,
 * and `onApplied` tells the app which stories changed under it.
 */
export default function useDriveSync({ flushSave, isDirty, onApplied }) {
  const [config, setConfig] = useState(null); // null until loaded
  const [status, setStatus] = useState(CLIENT_ID ? "off" : "unconfigured");
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState(null);
  const [progress, setProgress] = useState(null);
  const busyRef = useRef(false);
  const onAppliedRef = useRef(onApplied);
  onAppliedRef.current = onApplied;

  // What was remembered last time.
  useEffect(() => {
    let cancelled = false;
    loadDriveConfig().then((cfg) => {
      if (cancelled) return;
      setConfig(cfg);
      if (CLIENT_ID && cfg.enabled) setStatus(hasToken() ? "idle" : "signin");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const enabled = !!config?.enabled && !!CLIENT_ID;

  const syncNow = useCallback(
    async ({ interactive = false } = {}) => {
      if (!CLIENT_ID || busyRef.current) return;
      busyRef.current = true;
      setStatus("syncing");
      setError(null);
      setProgress(null);
      try {
        await getAccessToken({ interactive });
        await flushSave?.();
        const result = await runSync({
          isDirty: isDirty ?? (() => false),
          onProgress: setProgress,
        });
        const at = Date.now();
        setSummary({ ...result, at });
        setConfig((c) => ({ ...(c ?? {}), lastSyncAt: at }));
        if (result.changedStoryIds.length || result.deletedStoryIds.length) {
          onAppliedRef.current?.(result);
        }
        if (result.failures.length) {
          setError(
            `${result.failures.length} ${result.failures.length === 1 ? "story" : "stories"} did not sync: ${result.failures.join("; ")}`
          );
          setStatus("error");
        } else {
          setStatus("idle");
        }
      } catch (e) {
        if (e.code === "popup" || e.code === "signin") {
          setStatus("signin");
          setError(interactive ? e.message : null);
        } else {
          setStatus("error");
          setError(e.message || String(e));
        }
      } finally {
        busyRef.current = false;
        setProgress(null);
      }
    },
    [flushSave, isDirty]
  );

  /** A click on Connect: consent screen, then a first sync. */
  const connect = useCallback(async () => {
    if (!CLIENT_ID) return;
    setError(null);
    try {
      await getAccessToken({ interactive: true });
    } catch (e) {
      setError(e.message);
      return;
    }
    const cfg = await saveDriveConfig({ enabled: true });
    setConfig(cfg);
    setStatus("idle");
    await syncNow({ interactive: true });
  }, [syncNow]);

  /** Stop syncing and let go of the token. Nothing is deleted anywhere. */
  const disconnect = useCallback(async () => {
    await signOut();
    const cfg = await saveDriveConfig({ enabled: false, folderId: null });
    setConfig(cfg);
    setStatus("off");
    setError(null);
    setSummary(null);
  }, []);

  // The periodic sync, and one more whenever the tab comes back into view —
  // which is when a story made on the other device is most likely to be
  // wanted here.
  useEffect(() => {
    if (!enabled) return;
    syncNow();
    const timer = setInterval(() => syncNow(), INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") syncNow();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, syncNow]);

  return {
    configured: !!CLIENT_ID,
    enabled,
    status,
    error,
    summary,
    progress,
    lastSyncAt: config?.lastSyncAt ?? null,
    connect,
    disconnect,
    syncNow,
  };
}
