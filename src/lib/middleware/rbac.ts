// ============================================================================
// RBAC Middleware — Role-Based Access Control
// ============================================================================
//
// Composable middleware functions for protecting API routes:
//
//   requireAuth(req)              → Verifies JWT, returns AuthContext
//   requireRole(req, roles)       → Verifies JWT + checks role ∈ roles
//   requireOwnership(req, ownerId) → Verifies user owns the resource OR is ADMIN
//
// These are pure functions that take a request object and return an
// AuthContext or throw an AuthError. They work with any HTTP framework.
// ============================================================================

import { UserRole } from "@prisma/client";
import { verifyAccessToken, extractBearerToken } from "../auth/jwt";
import { AuthError, type AuthContext, type MockRequest } from "../types/auth";

// ── requireAuth ──

/**
 * Extracts and verifies the JWT from the Authorization header.
 * Returns the authenticated user context.
 *
 * @throws AuthError(401) if token is missing, expired, or invalid
 */
export function requireAuth(req: MockRequest): AuthContext {
  const authHeader = req.headers["authorization"] ?? req.headers["Authorization"];
  const token = extractBearerToken(authHeader);

  if (!token) {
    throw new AuthError(401, "Authentication required — no token provided", "NO_TOKEN");
  }

  try {
    const payload = verifyAccessToken(token);
    return {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
      profileId: payload.profileId,
    };
  } catch (err: any) {
    if (err.name === "TokenExpiredError") {
      throw new AuthError(401, "Access token expired", "TOKEN_EXPIRED");
    }
    if (err.name === "JsonWebTokenError") {
      throw new AuthError(401, "Invalid access token", "INVALID_TOKEN");
    }
    throw new AuthError(401, "Authentication failed", "AUTH_FAILED");
  }
}

// ── requireRole ──

/**
 * Verifies the JWT AND checks that the user's role is in the allowed list.
 *
 * Usage:
 *   const ctx = requireRole(req, [UserRole.DOCTOR, UserRole.ADMIN]);
 *
 * @throws AuthError(401) if not authenticated
 * @throws AuthError(403) if role is not in allowedRoles
 */
export function requireRole(
  req: MockRequest,
  allowedRoles: UserRole[]
): AuthContext {
  const ctx = requireAuth(req);

  if (!allowedRoles.includes(ctx.role)) {
    throw new AuthError(
      403,
      `Access denied — requires one of: ${allowedRoles.join(", ")}`,
      "INSUFFICIENT_ROLE"
    );
  }

  return ctx;
}

// ── requireOwnership ──

/**
 * Verifies the JWT AND checks that the authenticated user owns the resource.
 * Admins bypass ownership checks (they can access any resource).
 *
 * Usage:
 *   const appointment = await prisma.appointment.findUnique(...);
 *   const ctx = requireOwnership(req, appointment.patientId);
 *
 * @param resourceOwnerId The userId or profileId that owns the resource
 * @param matchField Whether to match against 'userId' or 'profileId' in the context
 *
 * @throws AuthError(401) if not authenticated
 * @throws AuthError(403) if not the owner and not an admin
 */
export function requireOwnership(
  req: MockRequest,
  resourceOwnerId: string,
  matchField: "userId" | "profileId" = "profileId"
): AuthContext {
  const ctx = requireAuth(req);

  // Admins can access any resource
  if (ctx.role === UserRole.ADMIN) {
    return ctx;
  }

  const userValue = matchField === "userId" ? ctx.userId : ctx.profileId;

  if (userValue !== resourceOwnerId) {
    throw new AuthError(
      403,
      "Access denied — you can only access your own resources",
      "NOT_OWNER"
    );
  }

  return ctx;
}

// ── Helper: wrap handler with error handling ──

/**
 * Wraps a handler function with auth error handling.
 * Catches AuthError and returns the appropriate HTTP response.
 */
export function withErrorHandling(
  handler: (req: MockRequest) => Promise<{ status: number; body: any }>
): (req: MockRequest) => Promise<{ status: number; body: any }> {
  return async (req: MockRequest) => {
    try {
      return await handler(req);
    } catch (err) {
      if (err instanceof AuthError) {
        return {
          status: err.statusCode,
          body: {
            error: err.message,
            code: err.code,
          },
        };
      }
      // Unexpected error
      console.error("Unhandled error in route handler:", err);
      return {
        status: 500,
        body: {
          error: "Internal server error",
          code: "INTERNAL_ERROR",
        },
      };
    }
  };
}
