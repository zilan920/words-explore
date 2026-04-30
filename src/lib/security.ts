import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { ApiError } from "@/lib/api";
import type { RateLimitResult, StorageAdapter } from "@/lib/db/storage";

export function generateAccessToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashAccessToken(accessToken: string): string {
  return createHash("sha256").update(accessToken).digest("hex");
}

export function verifyAccessTokenHash(accessToken: string, expectedHash: string | null): boolean {
  if (!expectedHash) {
    return false;
  }

  const actual = Buffer.from(hashAccessToken(accessToken), "hex");
  const expected = Buffer.from(expectedHash, "hex");

  if (actual.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(actual, expected);
}

export async function requireUserAuth(
  request: Request,
  storage: StorageAdapter,
  username: string
): Promise<void> {
  const accessToken = getBearerToken(request);
  if (!accessToken) {
    throw new ApiError(401, "需要有效的访问令牌");
  }

  const authorized = await storage.verifyUserAccess(username, hashAccessToken(accessToken));
  if (!authorized) {
    throw new ApiError(401, "需要有效的访问令牌");
  }
}

export async function enforceRateLimit(
  storage: StorageAdapter,
  options: {
    key: string;
    max: number;
    windowMs: number;
  }
): Promise<RateLimitResult> {
  const result = await storage.checkRateLimit(options.key, options.max, options.windowMs);
  if (!result.allowed) {
    throw new ApiError(429, `请求过于频繁，请 ${result.retryAfterSeconds} 秒后再试`);
  }

  return result;
}

export async function acquireRequestLock(
  storage: StorageAdapter,
  key: string,
  ttlMs: number
): Promise<() => Promise<void>> {
  const acquired = await storage.acquireLock(key, ttlMs);
  if (!acquired) {
    throw new ApiError(429, "上一轮请求仍在处理中，请稍后再试");
  }

  return () => storage.releaseLock(key);
}

export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (
    forwardedFor ||
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("cf-connecting-ip")?.trim() ||
    "unknown"
  );
}

export function rateLimitKey(...parts: Array<string | number | null | undefined>): string {
  const raw = parts.map((part) => String(part ?? "")).join("|");
  return createHash("sha256").update(raw).digest("hex");
}

function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.slice("Bearer ".length).trim();
  if (token.length < 32 || token.length > 256) {
    return null;
  }

  return token;
}
