/**
 * The thinnest possible Google Drive client: sign-in through Google Identity
 * Services, and the handful of REST calls the backup needs.
 *
 * Nothing here knows what a story is. It makes folders, puts named blobs in
 * them, and reports what is there. Nothing is ever read back out.
 *
 * Scope is `drive.file`: the app can see and touch only files it created
 * itself, never the rest of the user's Drive. Google classes that scope as
 * non-sensitive, so the OAuth client needs no verification review.
 *
 * Tokens come from the GIS "token model": an access token good for about an
 * hour, handed over through a popup. There is no refresh token in a browser
 * app, so when one lapses the next sync asks for another — silently where
 * Google allows it, otherwise through a button a grown-up presses.
 */

const GIS_SRC = "https://accounts.google.com/gsi/client";
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const TOKEN_KEY = "storymaker_drive_token";

/** The OAuth client id, baked in at build time. Empty means "not set up". */
export const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";

export class DriveError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = "DriveError";
    this.status = status; // HTTP status, when there was one
    this.code = code; // "signin" | "popup" | "network" | "notfound" | "api"
  }
}

/* ---- loading Google Identity Services ---- */

let gisPromise = null;

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gisPromise = null;
      reject(
        new DriveError("Could not load Google sign-in.", { code: "network" })
      );
    };
    document.head.appendChild(script);
  });
  return gisPromise;
}

/* ---- tokens ---- */

let tokenClient = null;
let token = null; // { accessToken, expiresAt }

function readStoredToken() {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw);
    return t?.accessToken && t?.expiresAt ? t : null;
  } catch {
    return null;
  }
}

function storeToken(t) {
  token = t;
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, JSON.stringify(t));
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* sessionStorage unavailable – the token still holds until reload */
  }
}

function validToken() {
  if (!token) token = readStoredToken();
  // A minute of slack: a token that dies mid-upload fails the whole sync.
  if (token && token.expiresAt - Date.now() > 60_000) return token.accessToken;
  return null;
}

/** True when a usable token is in hand, without asking Google anything. */
export function hasToken() {
  return !!validToken();
}

/**
 * Get an access token, asking Google for a fresh one when needed.
 *
 * `interactive: true` is for a click: it may show the consent screen.
 * `interactive: false` is for a timer: Google is asked quietly, and a popup
 * the browser blocks surfaces as a DriveError with code "popup" so the UI can
 * offer a button instead.
 */
export async function getAccessToken({ interactive = false } = {}) {
  const have = validToken();
  if (have) return have;
  if (!CLIENT_ID) {
    throw new DriveError(
      "Google Drive backup is not set up: VITE_GOOGLE_CLIENT_ID is missing.",
      { code: "config" }
    );
  }
  await loadGis();

  return new Promise((resolve, reject) => {
    if (!tokenClient) {
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPE,
        callback: () => {},
        error_callback: () => {},
      });
    }
    tokenClient.callback = (resp) => {
      if (resp.error) {
        reject(
          new DriveError(resp.error_description || resp.error, {
            code: "signin",
          })
        );
        return;
      }
      const t = {
        accessToken: resp.access_token,
        expiresAt: Date.now() + Number(resp.expires_in ?? 3600) * 1000,
      };
      storeToken(t);
      resolve(t.accessToken);
    };
    tokenClient.error_callback = (err) => {
      const blocked =
        err?.type === "popup_failed_to_open" || err?.type === "popup_closed";
      reject(
        new DriveError(
          blocked
            ? "Google needs a sign-in to carry on backing up."
            : err?.message || "Google sign-in failed.",
          { code: blocked ? "popup" : "signin" }
        )
      );
    };
    tokenClient.requestAccessToken({ prompt: interactive ? "consent" : "" });
  });
}

/** Drop the token and tell Google to revoke it. Best effort. */
export async function signOut() {
  const t = validToken();
  storeToken(null);
  if (t && window.google?.accounts?.oauth2) {
    await new Promise((resolve) =>
      window.google.accounts.oauth2.revoke(t, () => resolve())
    );
  }
}

/* ---- REST ---- */

async function request(path, { method = "GET", body, headers, raw } = {}) {
  const accessToken = await getAccessToken();
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, ...(headers ?? {}) },
      body,
    });
  } catch {
    throw new DriveError("Could not reach Google Drive.", { code: "network" });
  }
  if (res.status === 401) {
    // The token Google gave us is no longer good: forget it, so the next
    // attempt asks for another rather than failing the same way again.
    storeToken(null);
    throw new DriveError("Google Drive signed us out.", {
      status: 401,
      code: "signin",
    });
  }
  if (res.status === 404) {
    throw new DriveError("Not found on Google Drive.", {
      status: 404,
      code: "notfound",
    });
  }
  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json();
      detail = j?.error?.message ?? "";
    } catch {
      /* no body worth reading */
    }
    throw new DriveError(
      `Google Drive said ${res.status}${detail ? `: ${detail}` : ""}`,
      { status: res.status, code: "api" }
    );
  }
  return raw ? res : res.json();
}

const FOLDER_MIME = "application/vnd.google-apps.folder";
const FILE_FIELDS = "id,name,mimeType,parents,modifiedTime,appProperties";

function q(parts) {
  return encodeURIComponent(parts.join(" and "));
}

function esc(v) {
  return String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function toFile(f) {
  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    parents: f.parents ?? [],
    modifiedTime: Date.parse(f.modifiedTime),
    appProperties: f.appProperties ?? {},
  };
}

async function listQuery(parts) {
  const out = [];
  let pageToken = "";
  do {
    const page = await request(
      `${API}/files?q=${q(parts)}` +
        `&fields=nextPageToken,files(${FILE_FIELDS})&pageSize=1000` +
        (pageToken ? `&pageToken=${pageToken}` : "")
    );
    for (const f of page.files ?? []) out.push(toFile(f));
    pageToken = page.nextPageToken ?? "";
  } while (pageToken);
  return out;
}

/** Create a folder. Returns its id. */
export async function createFolder(name, { parentId, appProperties } = {}) {
  const body = { name, mimeType: FOLDER_MIME };
  if (parentId) body.parents = [parentId];
  if (appProperties) body.appProperties = appProperties;
  const created = await request(`${API}/files?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return created.id;
}

/** Find the app's top folder by id, or by name, or create it. Returns its id. */
export async function ensureFolder(name, knownId) {
  if (knownId) {
    try {
      const f = await request(`${API}/files/${knownId}?fields=id,trashed`);
      if (!f.trashed) return f.id;
    } catch (e) {
      if (e.code !== "notfound") throw e;
    }
  }
  const found = await listQuery([
    `mimeType='${FOLDER_MIME}'`,
    `name='${esc(name)}'`,
    "trashed=false",
    "'root' in parents",
  ]);
  if (found.length) return found[0].id;
  return createFolder(name);
}

/**
 * The app's folders carrying every one of the given tags, wherever they
 * sit. How a story's folder is found again when the bookkeeping has been
 * forgotten: every story has a permanent unique id, every browser has one
 * too, and a story folder is tagged with both.
 */
export async function findFoldersByTags(tags) {
  return listQuery([
    `mimeType='${FOLDER_MIME}'`,
    ...Object.entries(tags).map(
      ([k, v]) => `appProperties has { key='${esc(k)}' and value='${esc(v)}' }`
    ),
    "trashed=false",
  ]);
}

/**
 * Every live file directly inside a folder, across however many pages
 * Drive splits the listing into.
 * Each is { id, name, mimeType, parents, modifiedTime (ms), appProperties }.
 */
export async function listFiles(folderId) {
  return listQuery([`'${folderId}' in parents`, "trashed=false"]);
}

/** Is this file still live? false when trashed, or gone altogether. */
export async function isFileLive(fileId) {
  try {
    const f = await request(`${API}/files/${fileId}?fields=id,trashed`);
    return !f.trashed;
  } catch (e) {
    if (e.code === "notfound") return false;
    throw e; // anything else is "don't know", never "gone"
  }
}

/** Drive takes at most 5 MB in one multipart request; above that, resumable. */
const MULTIPART_LIMIT = 4 * 1024 * 1024;

/**
 * Create or overwrite a file. Returns { id, modifiedTime (ms) }.
 *
 * Small files go as one multipart request: metadata and bytes together.
 * A big picture — a camera photo put on a page by hand, a large model
 * output — goes by the resumable protocol instead: one request to open
 * the session with the metadata, one to put the bytes.
 */
export async function uploadFile({ fileId, folderId, name, appProperties, blob }) {
  const metadata = { name };
  if (appProperties) metadata.appProperties = appProperties;
  if (!fileId) metadata.parents = [folderId];
  const method = fileId ? "PATCH" : "POST";
  const base = fileId ? `${UPLOAD_API}/files/${fileId}` : `${UPLOAD_API}/files`;

  if (blob.size <= MULTIPART_LIMIT) {
    const form = new FormData();
    form.append(
      "metadata",
      new Blob([JSON.stringify(metadata)], { type: "application/json" })
    );
    form.append("file", blob);
    const f = await request(`${base}?uploadType=multipart&fields=id,modifiedTime`, {
      method,
      body: form,
    });
    return { id: f.id, modifiedTime: Date.parse(f.modifiedTime) };
  }

  const opened = await request(`${base}?uploadType=resumable&fields=id,modifiedTime`, {
    method,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": blob.type || "application/octet-stream",
      "X-Upload-Content-Length": String(blob.size),
    },
    body: JSON.stringify(metadata),
    raw: true,
  });
  const session = opened.headers.get("Location");
  if (!session) {
    throw new DriveError("Google Drive did not open an upload session.", {
      code: "api",
    });
  }
  // The session URL carries its own authorisation; the bytes go in one PUT.
  let res;
  try {
    res = await fetch(session, {
      method: "PUT",
      headers: { "Content-Type": blob.type || "application/octet-stream" },
      body: blob,
    });
  } catch {
    throw new DriveError("Could not reach Google Drive.", { code: "network" });
  }
  if (!res.ok) {
    throw new DriveError(`Google Drive said ${res.status} to the upload.`, {
      status: res.status,
      code: "api",
    });
  }
  const f = await res.json();
  return { id: f.id, modifiedTime: Date.parse(f.modifiedTime) };
}

/** Change a file's or folder's name. */
export async function renameFile(fileId, name) {
  await request(`${API}/files/${fileId}?fields=id`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

