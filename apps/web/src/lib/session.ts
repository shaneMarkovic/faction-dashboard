import "server-only";
import { cookies } from "next/headers";
import { signSession, verifySession, type SessionPayload } from "./session-crypto";

export const SESSION_COOKIE = "tw_session";
const MAX_AGE = 30 * 24 * 3600; // 30 days

function secret(): string {
  return process.env.SESSION_SECRET ?? "";
}

/** Current verified session, or null. */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value, secret());
}

export async function setSession(identity: Omit<SessionPayload, "exp">): Promise<void> {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const token = await signSession({ ...identity, exp }, secret());
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
