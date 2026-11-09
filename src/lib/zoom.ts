import { db } from "./db";
import { env } from "./env";
import { decrypt, encrypt } from "./crypto";

/**
 * Zoom: a new Zoom meeting for every booked call.
 *
 * Uses a Zoom "General app" (OAuth, user-managed) that the team creates once in the Zoom App Marketplace.
 * Its Client ID and Client secret are saved in Settings → Integrations (or ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET),
 * then a teammate presses Connect Zoom and approves. Meetings are created in that person's Zoom account.
 */

const AUTH = "https://zoom.us/oauth/authorize";
const TOKEN = "https://zoom.us/oauth/token";
const API = "https://api.zoom.us/v2";

export const zoomRedirectUri = () => `${env.appUrl}/api/oauth/zoom/callback`;

export async function zoomSettings() {
  const row = await db.integration.findUnique({ where: { provider: "ZOOM" } });
  const clientId = process.env.ZOOM_CLIENT_ID || row?.clientId || "";
  const clientSecret = process.env.ZOOM_CLIENT_SECRET || (row?.clientSecretEnc ? decrypt(row.clientSecretEnc) : "");
  return {
    row,
    clientId,
    clientSecret,
    appReady: Boolean(clientId && clientSecret),
    connected: Boolean(row?.refreshTokenEnc),
    fromEnv: Boolean(process.env.ZOOM_CLIENT_ID),
  };
}

export function zoomAuthUrl(clientId: string, state: string) {
  const u = new URL(AUTH);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", zoomRedirectUri());
  u.searchParams.set("state", state);
  return u.toString();
}

async function tokenRequest(body: Record<string, string>, clientId: string, clientSecret: string) {
  const res = await fetch(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}` },
    body: new URLSearchParams(body),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; reason?: string; error?: string };
  if (!res.ok || !data.access_token) throw new Error(`Zoom sign-in failed: ${data.reason || data.error || res.status}`);
  return data as { access_token: string; refresh_token: string; expires_in: number };
}

async function store(t: { access_token: string; refresh_token: string; expires_in: number }, extra: Record<string, unknown> = {}) {
  const data = {
    accessTokenEnc: encrypt(t.access_token),
    refreshTokenEnc: encrypt(t.refresh_token),
    expiresAt: new Date(Date.now() + (t.expires_in - 120) * 1000),
    lastError: null,
    ...extra,
  };
  await db.integration.upsert({ where: { provider: "ZOOM" }, create: { provider: "ZOOM", ...data }, update: data });
}

/** Finishes "Connect Zoom": swaps the code for tokens and records whose Zoom account it is. */
export async function connectZoom(code: string) {
  const s = await zoomSettings();
  if (!s.appReady) throw new Error("Add the Zoom app's Client ID and Client secret first.");
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: zoomRedirectUri() }, s.clientId, s.clientSecret);
  const me = await fetch(`${API}/users/me`, { headers: { authorization: `Bearer ${t.access_token}` } }).then((r) => r.json()).catch(() => ({}));
  await store(t, { accountEmail: (me as { email?: string }).email ?? null, connectedAt: new Date() });
}

async function accessToken(): Promise<string> {
  const s = await zoomSettings();
  if (!s.row?.refreshTokenEnc) throw new Error("Zoom is not connected.");
  if (s.row.accessTokenEnc && s.row.expiresAt && s.row.expiresAt > new Date()) return decrypt(s.row.accessTokenEnc);
  try {
    const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: decrypt(s.row.refreshTokenEnc) }, s.clientId, s.clientSecret);
    await store(t);
    return t.access_token;
  } catch (err) {
    await db.integration.update({ where: { provider: "ZOOM" }, data: { lastError: (err as Error).message.slice(0, 300) } });
    throw err;
  }
}

async function zoomApi(path: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${await accessToken()}`, ...(init.headers ?? {}) } });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Zoom: ${(data as { message?: string }).message || res.status}`);
  return data;
}

export async function createZoomMeeting(m: { topic: string; start: Date; durationMin: number; timezone: string; agenda?: string }) {
  const data = (await zoomApi("/users/me/meetings", {
    method: "POST",
    body: JSON.stringify({
      topic: m.topic.slice(0, 200),
      type: 2,
      start_time: m.start.toISOString().replace(/\.\d{3}Z$/, "Z"),
      duration: m.durationMin,
      timezone: m.timezone,
      agenda: m.agenda?.slice(0, 2000),
      settings: { join_before_host: true, waiting_room: false, host_video: true, participant_video: true, mute_upon_entry: false },
    }),
  })) as { id: number; join_url: string; password?: string };
  return { id: String(data.id), joinUrl: data.join_url, password: data.password ?? null };
}

export async function updateZoomMeeting(id: string, m: { start: Date; durationMin: number; timezone: string }) {
  await zoomApi(`/meetings/${id}`, { method: "PATCH", body: JSON.stringify({ start_time: m.start.toISOString().replace(/\.\d{3}Z$/, "Z"), duration: m.durationMin, timezone: m.timezone }) });
}

export async function deleteZoomMeeting(id: string) {
  await zoomApi(`/meetings/${id}`, { method: "DELETE" }).catch(() => undefined);
}

export async function disconnectZoom() {
  await db.integration.updateMany({ where: { provider: "ZOOM" }, data: { accessTokenEnc: null, refreshTokenEnc: null, expiresAt: null, accountEmail: null, connectedAt: null } });
}
