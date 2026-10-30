import { SignJWT, importPKCS8, decodeJwt } from "jose";
import { env } from "../env";

/**
 * OAuth for Google and Microsoft mailboxes.
 * We request IMAP + SMTP access (not the Gmail/Graph REST APIs) so every provider is
 * driven by the same sending and inbox-reading code.
 */

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_SCOPES = ["https://mail.google.com/", "openid", "email", "profile"];

const msBase = () => `https://login.microsoftonline.com/${env.microsoft.tenant}/oauth2/v2.0`;
const MS_SCOPES = [
  "offline_access",
  "openid",
  "email",
  "profile",
  "https://outlook.office.com/SMTP.Send",
  "https://outlook.office.com/IMAP.AccessAsUser.All",
];

export const redirectUri = (provider: "google" | "microsoft") => `${env.appUrl}/api/oauth/${provider}/callback`;

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  email?: string;
  name?: string;
}

async function postForm(url: string, body: Record<string, string>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = (json.error_description || json.error || res.statusText) as string;
    const err = new Error(`Token request failed: ${msg}`) as Error & { code?: string };
    err.code = String(json.error ?? "token_error");
    throw err;
  }
  return json;
}

function toTokenSet(json: Record<string, unknown>): TokenSet {
  const t: TokenSet = {
    accessToken: String(json.access_token),
    refreshToken: json.refresh_token ? String(json.refresh_token) : undefined,
    expiresAt: new Date(Date.now() + (Number(json.expires_in ?? 3600) - 60) * 1000),
  };
  if (typeof json.id_token === "string") {
    const claims = decodeJwt(json.id_token);
    t.email = String(claims.email ?? claims.preferred_username ?? "").toLowerCase() || undefined;
    t.name = claims.name ? String(claims.name) : undefined;
  }
  return t;
}

// ─── Google ──────────────────────────────────────────────────────────────

export function googleAuthUrl(state: string, loginHint?: string) {
  const p = new URLSearchParams({
    client_id: env.google.clientId,
    redirect_uri: redirectUri("google"),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  if (loginHint) p.set("login_hint", loginHint);
  return `${GOOGLE_AUTH}?${p}`;
}

export async function googleExchange(code: string) {
  return toTokenSet(
    await postForm(GOOGLE_TOKEN, {
      code,
      client_id: env.google.clientId,
      client_secret: env.google.clientSecret,
      redirect_uri: redirectUri("google"),
      grant_type: "authorization_code",
    }),
  );
}

export async function googleRefresh(refreshToken: string) {
  return toTokenSet(
    await postForm(GOOGLE_TOKEN, {
      refresh_token: refreshToken,
      client_id: env.google.clientId,
      client_secret: env.google.clientSecret,
      grant_type: "refresh_token",
    }),
  );
}

/** Google Workspace domain-wide delegation: mint a token for any user in the domain. */
export async function googleServiceAccountToken(userEmail: string) {
  const sa = JSON.parse(env.google.serviceAccountJson) as { client_email: string; private_key: string };
  const key = await importPKCS8(sa.private_key, "RS256");
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: "https://mail.google.com/" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setSubject(userEmail)
    .setAudience(GOOGLE_TOKEN)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
  return toTokenSet(
    await postForm(GOOGLE_TOKEN, { grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  );
}

// ─── Microsoft ───────────────────────────────────────────────────────────

export function microsoftAuthUrl(state: string, loginHint?: string) {
  const p = new URLSearchParams({
    client_id: env.microsoft.clientId,
    redirect_uri: redirectUri("microsoft"),
    response_type: "code",
    response_mode: "query",
    scope: MS_SCOPES.join(" "),
    prompt: "select_account",
    state,
  });
  if (loginHint) p.set("login_hint", loginHint);
  return `${msBase()}/authorize?${p}`;
}

export async function microsoftExchange(code: string) {
  return toTokenSet(
    await postForm(`${msBase()}/token`, {
      code,
      client_id: env.microsoft.clientId,
      client_secret: env.microsoft.clientSecret,
      redirect_uri: redirectUri("microsoft"),
      grant_type: "authorization_code",
      scope: MS_SCOPES.join(" "),
    }),
  );
}

export async function microsoftRefresh(refreshToken: string) {
  return toTokenSet(
    await postForm(`${msBase()}/token`, {
      refresh_token: refreshToken,
      client_id: env.microsoft.clientId,
      client_secret: env.microsoft.clientSecret,
      grant_type: "refresh_token",
      scope: MS_SCOPES.join(" "),
    }),
  );
}
