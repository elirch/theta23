// Owner authentication. One shared owner password, checked server-side, and an
// HMAC-signed, httpOnly session cookie. Deliberately small: no user management.

import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "theta23_owner";
const SESSION_HOURS = 12;

function config(): { password: string; secret: string } | null {
  const password = process.env.OWNER_PASSWORD;
  const secret = process.env.SESSION_SECRET;
  if (!password || !secret || secret.length < 16) return null;
  return { password, secret };
}

/** Owner sign-in is only available when both secrets are configured. */
export function isOwnerLoginConfigured(): boolean {
  return config() !== null;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function createSessionToken(secret: string, nowMs: number): string {
  const payload = `owner.${nowMs + SESSION_HOURS * 3_600_000}`;
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySessionToken(token: string | undefined, secret: string, nowMs: number): boolean {
  if (!token) return false;
  const lastDot = token.lastIndexOf(".");
  if (lastDot < 0) return false;
  const payload = token.slice(0, lastDot);
  if (!safeEqual(token.slice(lastDot + 1), sign(payload, secret))) return false;
  const [role, expires] = payload.split(".");
  return role === "owner" && Number(expires) > nowMs;
}

export async function isOwner(): Promise<boolean> {
  const cfg = config();
  if (!cfg) return false;
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value, cfg.secret, Date.now());
}

export async function signIn(password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const cfg = config();
  if (!cfg) return { ok: false, error: "Owner sign-in is not configured on this deployment." };
  if (typeof password !== "string" || !safeEqual(password, cfg.password)) {
    // Slow down guessing a little.
    await new Promise((resolve) => setTimeout(resolve, 600));
    return { ok: false, error: "Incorrect password." };
  }
  const store = await cookies();
  store.set(SESSION_COOKIE, createSessionToken(cfg.secret, Date.now()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
  return { ok: true };
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
