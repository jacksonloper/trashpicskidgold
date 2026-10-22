import { useCallback, useEffect, useRef, useState } from "react";
import {
  CLIENT_ID,
  canRenewQuietly,
  getAccessToken,
  hasToken,
  signOut,
} from "./driveClient";
import { loadDriveConfig, saveDriveConfig, runBackup } from "./runBackup";
import { clearBackupRecords } from "../db";

/** How often a quiet, open tab sends up whatever has changed. */
const INTERVAL_MS = 3 * 60 * 1000;

/**
 * The Drive backup as the app sees it: a status, a few buttons, a timer.
 *
 * Statuses:
 *   unconfigured  no client id was built in — the section explains how
 *   off           set up, but the grown-up has not connected it
 *   idle          connected; nothing happening
 *   backing-up    an upload is in flight
 *   signin        connected, but Google wants a click before the next one
 *   error         the last backup did not finish; `error` says how
 *
 * `flushSave` is awaited before each backup so the newest keystroke is in
 * the database before it is read for upload.
 */
export default function useDriveBackup({ flushSave }) {
  const [config, setConfig] = useState(null); // null until loaded
  const [status, setStatus] = useState(CLIENT_ID ? "off" : "unconfigured");
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState(null);
  const [progress, setProgress] = useState(null);
  const busyRef = useRef(false);

  // What was remembered last time.
  useEffect(() => {
    let cancelled = false;
    loadDriveConfig().then((cfg) => {
      if (cancelled) return;
      setConfig(cfg);
      if (CLIENT_ID && cfg.enabled) {
        setStatus(hasToken() || canRenewQuietly() ? "idle" : "signin");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const enabled = !!config?.enabled && !!CLIENT_ID;

  const backUpNow = useCallback(
    async ({ interactive = false } = {}) => {
      if (!CLIENT_ID || busyRef.current) return;
      // Without the server, Google hands out a token only through a popup,
      // and a browser lets a popup open only on a click. A timer with no
      // token in hand would only get itself blocked, and blocked again
      // three minutes later; so it just turns the cloud amber and waits for
      // the click. With the server, the cookie renews it quietly.
      if (!interactive && !hasToken() && !canRenewQuietly()) {
        setStatus("signin");
        return;
      }
      busyRef.current = true;
      setStatus("backing-up");
      setError(null);
      setProgress(null);
      try {
        await getAccessToken({ interactive });
        await flushSave?.();
        const result = await runBackup({ onProgress: setProgress });
        const at = Date.now();
        setSummary({ ...result, at });
        setConfig((c) => ({ ...(c ?? {}), lastBackupAt: at }));
        if (result.failures.length) {
          setError(
            `${result.failures.length} ${result.failures.length === 1 ? "story" : "stories"} did not go up: ${result.failures.join("; ")}`
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
    [flushSave]
  );

  /** A click on Connect: consent screen, then a first backup of everything. */
  const connect = useCallback(async () => {
    if (!CLIENT_ID) return;
    setError(null);
    try {
      await getAccessToken({ interactive: true });
    } catch (e) {
      setError(e.message);
      return;
    }
    // Whatever was remembered belonged to whichever Drive was connected
    // before. This one gets every story afresh.
    await clearBackupRecords();
    const cfg = await saveDriveConfig({ enabled: true, folderId: null });
    setConfig(cfg);
    setStatus("idle");
    await backUpNow({ interactive: true });
  }, [backUpNow]);

  /** Stop backing up and let go of the token. Nothing is deleted anywhere. */
  const disconnect = useCallback(async () => {
    await signOut();
    await clearBackupRecords();
    const cfg = await saveDriveConfig({ enabled: false, folderId: null });
    setConfig(cfg);
    setStatus("off");
    setError(null);
    setSummary(null);
  }, []);

  // The periodic backup, and one more whenever the tab is hidden — which
  // is when a grown-up has just stopped working and the newest words are
  // most worth having somewhere safe.
  useEffect(() => {
    if (!enabled) return;
    backUpNow();
    const timer = setInterval(() => backUpNow(), INTERVAL_MS);
    const onHidden = () => {
      if (document.visibilityState === "hidden") backUpNow();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [enabled, backUpNow]);

  return {
    configured: !!CLIENT_ID,
    enabled,
    status,
    error,
    summary,
    progress,
    lastBackupAt: config?.lastBackupAt ?? null,
    connect,
    disconnect,
    backUpNow,
  };
}
