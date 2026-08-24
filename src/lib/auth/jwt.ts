// ============================================================================
// JWT Token Management — Access tokens + Refresh token rotation
// ============================================================================
//
// Access token:  Short-lived (15 min), contains role claims, stateless
// Refresh token: Long-lived (7 days), stored in DB, rotated on each use
//
// Rotation: When a refresh token is used, it's revoked and a new one is
// issued. If a revoked token is re-used (replay attack), the entire
// token family is revoked for safety.
// ============================================================================

import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import type { JwtPayload, AuthTokens } from "../types/auth";

// ── Configuration ──

const ACCESS_TOKEN_SECRET =
  process.env.JWT_ACCESS_SECRET || "dev-access-secret-change-in-production";
const REFRESH_TOKEN_SECRET =
  process.env.JWT_REFRESH_SECRET || "dev-refresh-secret-change-in-production";

const ACCESS_TOKEN_EXPIRY = "15m";   // 15 minutes
const REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

// ── Access Token ──

/**
 * Sign a short-lived access token with user claims.
 * Contains: userId, email, role, profileId
 */
export function signAccessToken(payload: JwtPayload): string {
  const { iat, exp, ...claims } = payload; // strip timing fields
  return jwt.sign(claims, ACCESS_TOKEN_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
    issuer: "healthcare-app",
    audience: "healthcare-api",
  });
}

/**
 * Verify and decode an access token.
 * Throws if expired, malformed, or tampered with.
 */
export function verifyAccessToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET, {
    issuer: "healthcare-app",
    audience: "healthcare-api",
  });
  return decoded as JwtPayload;
}

// ── Refresh Token ──

/**
 * Generate a cryptographically random refresh token string.
 * This is NOT a JWT — it's an opaque token stored in the database.
 */
export function generateRefreshToken(): string {
  return uuidv4();
}

/**
 * Calculate refresh token expiry date.
 */
export function getRefreshTokenExpiry(): Date {
  return new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS);
}

// ── Token Pair ──

/**
 * Create a complete token pair (access + refresh).
 * The refresh token is an opaque UUID to be stored in DB.
 */
export function createTokenPair(payload: JwtPayload): AuthTokens {
  return {
    accessToken: signAccessToken(payload),
    refreshToken: generateRefreshToken(),
    expiresIn: 15 * 60, // 15 minutes in seconds
  };
}

// ── Helpers ──

/**
 * Extract the Bearer token from an Authorization header value.
 * Returns null if the header is missing or malformed.
 */
export function extractBearerToken(
  authHeader: string | undefined
): string | null {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.slice(7).trim();
}
