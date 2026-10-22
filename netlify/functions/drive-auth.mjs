/**
 * The one server-side piece of the Google Drive backup: keeping a sign-in
 * alive for longer than an hour.
 *
 * A browser on its own can only get hour-long access tokens from Google,
 * and only through a popup a person clicked for. This function holds the
 * OAuth client secret, which a browser never may, and uses it to turn the
 * one-time code Google's popup hands the browser into a refresh token.
 * The refresh token lives in an encrypted, HttpOnly cookie on this site,
 * so the browser's JavaScript never sees it, and the function mints a
 * fresh access token from it whenever the browser asks.
 *
 * No story, picture or word ever passes through here: the only things
 * that do are Google's tokens.
 *
 * Routes (all POST, same origin, JSON):
 *   /api/drive-auth/exchange  { code }  → { accessToken, expiresAt }  + sets cookie
 *   /api/drive-auth/refresh             → { accessToken, expiresAt }
 *   /api/drive-auth/signout             → {}                         + clears cookie
 *
 * Environment (Netlify → Site configuration → Environment variables):
 *   VITE_GOOGLE_CLIENT_ID   the OAuth client id (shared with the browser)
 *   GOOGLE_CLIENT_SECRET    its secret — server only, never VITE_
 *   DRIVE_COOKIE_SECRET     any long random string; encrypts the cookie
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const COOKIE = "drive_refresh";
const COOKIE_PATH = "/api/drive-auth";
const COOKIE_MAX_AGE = 180 * 24 * 60 * 60; // half a year of not having to click

export const config = { path: "/api/drive-auth/:action" };

export default async function handler(req, context) {
  // The action is the last part of the path, from the route param when
  // Netlify fills it in, from the URL itself otherwise.
  const action =
    context.params?.action ?? new URL(req.url).pathname.split("/").filter(Boolean).pop();
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const env = readEnv(context);
  if (!env.ok) return json({ error: env.error }, 500);

  try {
    switch (action) {
      case "exchange":
        return await exchange(req, env);
      case "refresh":
        return await refresh(req, env);
      case "signout":
        return await signout(req, env);
      default:
        return json({ error: "no such action" }, 404);
    }
  } catch (e) {
    return json({ error: e.message || "failed" }, 500);
  }
}

function readEnv(context) {
  const e = (globalThis.Netlify?.env?.toObject?.() ?? process.env) || {};
  const clientId = e.VITE_GOOGLE_CLIENT_ID;
  const clientSecret = e.GOOGLE_CLIENT_SECRET;
  const cookieSecret = e.DRIVE_COOKIE_SECRET;
  if (!clientId || !clientSecret || !cookieSecret) {
    return {
      ok: false,
      error:
        "drive-auth is not set up: VITE_GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and DRIVE_COOKIE_SECRET must all be set.",
    };
  }
  void context;
  return { ok: true, clientId, clientSecret, cookieSecret };
}

/* ---- routes ---- */

async function exchange(req, env) {
  const { code } = await req.json().catch(() => ({}));
  if (!code) return json({ error: "no code" }, 400);

  const t = await googleToken({
    code,
    client_id: env.clientId,
    client_secret: env.clientSecret,
    // What the GIS code client in popup mode uses: the code came back
    // through postMessage, not a redirect, and Google wants to hear that.
    redirect_uri: "postmessage",
    grant_type: "authorization_code",
  });
  if (!t.ok) return json({ error: t.error }, 401);

  const headers = {};
  if (t.refresh_token) {
    headers["Set-Cookie"] = setCookie(seal(t.refresh_token, env.cookieSecret));
  } else if (!readCookie(req)) {
    // Google only hands a refresh token over on the first consent. With
    // no cookie from an earlier one either, the sign-in would last an hour
    // and then need the popup again: say so, rather than pretend.
    return json(
      { error: "Google gave no refresh token. Disconnect, then connect again." },
      409
    );
  }
  return json(tokenBody(t), 200, headers);
}

async function refresh(req, env) {
  const sealed = readCookie(req);
  if (!sealed) return json({ error: "not signed in" }, 401);
  const refreshToken = open(sealed, env.cookieSecret);
  if (!refreshToken) return json({ error: "not signed in" }, 401, { "Set-Cookie": clearCookie() });

  const t = await googleToken({
    refresh_token: refreshToken,
    client_id: env.clientId,
    client_secret: env.clientSecret,
    grant_type: "refresh_token",
  });
  if (!t.ok) {
    // invalid_grant: revoked, expired (a consent screen still "in testing"
    // expires them after a week), or the password changed. The cookie is
    // worthless now; the browser will ask for a click.
    return json({ error: t.error }, 401, { "Set-Cookie": clearCookie() });
  }
  return json(tokenBody(t));
}

async function signout(req, env) {
  const sealed = readCookie(req);
  const refreshToken = sealed ? open(sealed, env.cookieSecret) : null;
  if (refreshToken) {
    // Best effort: a revoke that fails still leaves the cookie gone.
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }),
    }).catch(() => {});
  }
  return json({}, 200, { "Set-Cookie": clearCookie() });
}

/* ---- Google ---- */

async function googleToken(params) {
  let res;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    });
  } catch {
    return { ok: false, error: "could not reach Google" };
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    return {
      ok: false,
      error: body.error_description || body.error || `Google said ${res.status}`,
    };
  }
  return { ok: true, ...body };
}

function tokenBody(t) {
  return {
    accessToken: t.access_token,
    expiresAt: Date.now() + Number(t.expires_in ?? 3600) * 1000,
  };
}

/* ---- the cookie ---- */

function key(secret) {
  return createHash("sha256").update(secret).digest();
}

/** AES-256-GCM: iv.tag.ciphertext, base64url. Nothing readable, nothing forgeable. */
export function seal(plain, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString("base64url")).join(".");
}

export function open(sealed, secret) {
  try {
    const [iv, tag, enc] = sealed.split(".").map((s) => Buffer.from(s, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", key(secret), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch {
    return null; // tampered, or sealed under another secret
  }
}

function readCookie(req) {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return rest.join("=");
  }
  return null;
}

function setCookie(value) {
  return `${COOKIE}=${value}; Path=${COOKIE_PATH}; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Strict`;
}

function clearCookie() {
  return `${COOKIE}=; Path=${COOKIE_PATH}; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}
