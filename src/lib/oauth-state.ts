import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { env } from "./env";

/** Signed, short-lived OAuth `state` that also carries where to return and the limits chosen. */
export async function signState(payload: Record<string, string>) {
  return new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("15m").sign(new TextEncoder().encode(env.sessionSecret));
}
export async function verifyState(state: string) {
  const { payload } = await jwtVerify(state, new TextEncoder().encode(env.sessionSecret));
  return payload as Record<string, string>;
}
