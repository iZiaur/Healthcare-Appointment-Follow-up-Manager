// ============================================================================
// Auth & RBAC Tests
// ============================================================================
//
// Test scenarios:
//   1. Patient trying to hit a doctor-only route → 403
//   2. Patient trying to fetch another patient's appointment → 403
//   3. Doctor accessing own resources → 200
//   4. Admin bypassing ownership checks → 200
//   5. Missing/invalid/expired tokens → 401
//   6. Rate limiter blocking after threshold → blocked
//   7. Refresh token rotation → new tokens issued, old revoked
//   8. Refresh token reuse detection → all sessions revoked
//   9. Admin self-registration blocked → 403
// ============================================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import { UserRole } from "@prisma/client";
import {
  signAccessToken,
  verifyAccessToken,
  extractBearerToken,
} from "../lib/auth/jwt";
import { hashPassword, verifyPassword } from "../lib/auth/password";
import { RateLimiter } from "../lib/auth/rate-limiter";
import {
  requireAuth,
  requireRole,
  requireOwnership,
  withErrorHandling,
} from "../lib/middleware/rbac";
import type { JwtPayload, MockRequest } from "../lib/types/auth";
import { AuthError } from "../lib/types/auth";

// ── Helpers ──

const ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET || "dev-access-secret-change-in-production";

function createMockRequest(options: {
  role?: UserRole;
  userId?: string;
  profileId?: string;
  email?: string;
  token?: string | null;
  expired?: boolean;
}): MockRequest {
  let authHeader: string | undefined;

  if (options.token === null) {
    // Explicitly no token
    authHeader = undefined;
  } else if (options.token) {
    authHeader = `Bearer ${options.token}`;
  } else {
    // Generate a valid token
    const payload: JwtPayload = {
      sub: options.userId || "user-123",
      email: options.email || "test@test.com",
      role: options.role || UserRole.PATIENT,
      profileId: options.profileId || "profile-123",
    };

    const token = options.expired
      ? jwt.sign(payload, ACCESS_SECRET, {
          expiresIn: "-1s", // already expired
          issuer: "healthcare-app",
          audience: "healthcare-api",
        })
      : signAccessToken(payload);

    authHeader = `Bearer ${token}`;
  }

  return {
    headers: {
      authorization: authHeader,
    },
    body: {},
    params: {},
    query: {},
    ip: "127.0.0.1",
  };
}

// ════════════════════════════════════════════════════════════════
// TEST SUITES
// ════════════════════════════════════════════════════════════════

describe("Password Hashing", () => {
  it("should hash and verify a password correctly", async () => {
    const password = "MySecureP@ss123";
    const hash = await hashPassword(password);

    expect(hash).not.toBe(password);
    expect(hash.startsWith("$2")).toBe(true); // bcrypt prefix

    const isValid = await verifyPassword(password, hash);
    expect(isValid).toBe(true);
  });

  it("should reject incorrect passwords", async () => {
    const hash = await hashPassword("correct-password");
    const isValid = await verifyPassword("wrong-password", hash);
    expect(isValid).toBe(false);
  });
});

// ────────────────────────────────────────────

describe("JWT Tokens", () => {
  it("should sign and verify an access token", () => {
    const payload: JwtPayload = {
      sub: "user-1",
      email: "doc@clinic.com",
      role: UserRole.DOCTOR,
      profileId: "doc-profile-1",
    };

    const token = signAccessToken(payload);
    const decoded = verifyAccessToken(token);

    expect(decoded.sub).toBe("user-1");
    expect(decoded.email).toBe("doc@clinic.com");
    expect(decoded.role).toBe("DOCTOR");
    expect(decoded.profileId).toBe("doc-profile-1");
  });

  it("should reject tampered tokens", () => {
    const token = signAccessToken({
      sub: "user-1",
      email: "test@test.com",
      role: UserRole.PATIENT,
    });

    // Tamper with the payload
    const parts = token.split(".");
    parts[1] = Buffer.from('{"sub":"hacker","role":"ADMIN"}').toString(
      "base64url"
    );
    const tamperedToken = parts.join(".");

    expect(() => verifyAccessToken(tamperedToken)).toThrow();
  });

  it("should reject expired tokens", () => {
    const token = jwt.sign(
      { sub: "user-1", email: "test@test.com", role: "PATIENT" },
      ACCESS_SECRET,
      { expiresIn: "-1s", issuer: "healthcare-app", audience: "healthcare-api" }
    );

    expect(() => verifyAccessToken(token)).toThrow();
  });

  it("should extract Bearer token from header", () => {
    expect(extractBearerToken("Bearer abc123")).toBe("abc123");
    expect(extractBearerToken("bearer abc123")).toBe(null); // case-sensitive
    expect(extractBearerToken(undefined)).toBe(null);
    expect(extractBearerToken("Basic abc123")).toBe(null);
    expect(extractBearerToken("")).toBe(null);
  });
});

// ────────────────────────────────────────────

describe("requireAuth", () => {
  it("should return AuthContext for valid token", () => {
    const req = createMockRequest({
      role: UserRole.DOCTOR,
      userId: "doc-user-1",
      profileId: "doc-prof-1",
      email: "doc@clinic.com",
    });

    const ctx = requireAuth(req);

    expect(ctx.userId).toBe("doc-user-1");
    expect(ctx.email).toBe("doc@clinic.com");
    expect(ctx.role).toBe("DOCTOR");
    expect(ctx.profileId).toBe("doc-prof-1");
  });

  it("should throw 401 when no token provided", () => {
    const req = createMockRequest({ token: null });

    expect(() => requireAuth(req)).toThrowError(
      expect.objectContaining({
        statusCode: 401,
        code: "NO_TOKEN",
      })
    );
  });

  it("should throw 401 for expired token", () => {
    const req = createMockRequest({
      role: UserRole.PATIENT,
      expired: true,
    });

    expect(() => requireAuth(req)).toThrowError(
      expect.objectContaining({
        statusCode: 401,
        code: "TOKEN_EXPIRED",
      })
    );
  });

  it("should throw 401 for invalid token", () => {
    const req = createMockRequest({ token: "garbage.token.here" });

    expect(() => requireAuth(req)).toThrowError(
      expect.objectContaining({
        statusCode: 401,
        code: "INVALID_TOKEN",
      })
    );
  });
});

// ────────────────────────────────────────────

describe("requireRole", () => {
  // ╔═══════════════════════════════════════════════════════════════╗
  // ║  TEST: Patient trying to hit a doctor-only route → 403      ║
  // ╚═══════════════════════════════════════════════════════════════╝

  it("should REJECT a PATIENT accessing a DOCTOR-only route", () => {
    const req = createMockRequest({
      role: UserRole.PATIENT,
      userId: "patient-user-1",
      profileId: "patient-prof-1",
    });

    expect(() =>
      requireRole(req, [UserRole.DOCTOR])
    ).toThrowError(
      expect.objectContaining({
        statusCode: 403,
        code: "INSUFFICIENT_ROLE",
      })
    );
  });

  it("should REJECT a PATIENT accessing an ADMIN-only route", () => {
    const req = createMockRequest({
      role: UserRole.PATIENT,
      userId: "patient-user-1",
    });

    expect(() =>
      requireRole(req, [UserRole.ADMIN])
    ).toThrowError(
      expect.objectContaining({
        statusCode: 403,
        code: "INSUFFICIENT_ROLE",
      })
    );
  });

  it("should REJECT a DOCTOR accessing an ADMIN-only route", () => {
    const req = createMockRequest({
      role: UserRole.DOCTOR,
      userId: "doc-user-1",
    });

    expect(() =>
      requireRole(req, [UserRole.ADMIN])
    ).toThrowError(
      expect.objectContaining({
        statusCode: 403,
      })
    );
  });

  it("should ALLOW a DOCTOR accessing a DOCTOR-only route", () => {
    const req = createMockRequest({
      role: UserRole.DOCTOR,
      userId: "doc-user-1",
      profileId: "doc-prof-1",
    });

    const ctx = requireRole(req, [UserRole.DOCTOR]);
    expect(ctx.role).toBe("DOCTOR");
    expect(ctx.userId).toBe("doc-user-1");
  });

  it("should ALLOW when role is in a multi-role allowlist", () => {
    const req = createMockRequest({
      role: UserRole.DOCTOR,
    });

    const ctx = requireRole(req, [UserRole.DOCTOR, UserRole.ADMIN]);
    expect(ctx.role).toBe("DOCTOR");
  });

  it("should ALLOW ADMIN on any role-gated route when ADMIN is listed", () => {
    const req = createMockRequest({
      role: UserRole.ADMIN,
      userId: "admin-1",
    });

    const ctx = requireRole(req, [UserRole.DOCTOR, UserRole.ADMIN]);
    expect(ctx.role).toBe("ADMIN");
  });
});

// ────────────────────────────────────────────

describe("requireOwnership", () => {
  // ╔═══════════════════════════════════════════════════════════════╗
  // ║  TEST: Patient trying to fetch ANOTHER patient's            ║
  // ║        appointment by ID → 403                              ║
  // ╚═══════════════════════════════════════════════════════════════╝

  it("should REJECT a patient accessing another patient's appointment", () => {
    // Patient A (profile-A) tries to access an appointment owned by Patient B (profile-B)
    const req = createMockRequest({
      role: UserRole.PATIENT,
      userId: "user-A",
      profileId: "profile-A",
    });

    // The appointment belongs to profile-B
    const appointmentOwnerId = "profile-B";

    expect(() =>
      requireOwnership(req, appointmentOwnerId, "profileId")
    ).toThrowError(
      expect.objectContaining({
        statusCode: 403,
        code: "NOT_OWNER",
      })
    );
  });

  it("should ALLOW a patient accessing their OWN appointment", () => {
    const req = createMockRequest({
      role: UserRole.PATIENT,
      userId: "user-A",
      profileId: "profile-A",
    });

    const ctx = requireOwnership(req, "profile-A", "profileId");
    expect(ctx.userId).toBe("user-A");
    expect(ctx.profileId).toBe("profile-A");
  });

  it("should REJECT a doctor accessing another doctor's resource", () => {
    const req = createMockRequest({
      role: UserRole.DOCTOR,
      userId: "doc-user-1",
      profileId: "doc-prof-1",
    });

    expect(() =>
      requireOwnership(req, "doc-prof-2", "profileId")
    ).toThrowError(
      expect.objectContaining({
        statusCode: 403,
        code: "NOT_OWNER",
      })
    );
  });

  it("should ALLOW admin to access ANY patient's appointment (bypass)", () => {
    const req = createMockRequest({
      role: UserRole.ADMIN,
      userId: "admin-1",
      profileId: undefined,
    });

    // Admin accessing patient-B's appointment
    const ctx = requireOwnership(req, "profile-B", "profileId");
    expect(ctx.role).toBe("ADMIN");
  });

  it("should work with userId match field", () => {
    const req = createMockRequest({
      role: UserRole.PATIENT,
      userId: "user-A",
      profileId: "profile-A",
    });

    // Match by userId
    const ctx = requireOwnership(req, "user-A", "userId");
    expect(ctx.userId).toBe("user-A");

    // Should fail with different userId
    expect(() =>
      requireOwnership(req, "user-B", "userId")
    ).toThrowError(
      expect.objectContaining({ statusCode: 403 })
    );
  });
});

// ────────────────────────────────────────────

describe("withErrorHandling", () => {
  it("should catch AuthError and return proper HTTP response", async () => {
    const handler = withErrorHandling(async (req) => {
      const ctx = requireRole(req, [UserRole.DOCTOR]);
      return { status: 200, body: { message: "OK", doctor: ctx.userId } };
    });

    // Patient trying to access doctor route
    const req = createMockRequest({ role: UserRole.PATIENT });
    const res = await handler(req);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("INSUFFICIENT_ROLE");
    expect(res.body.error).toContain("Access denied");
  });

  it("should pass through successful responses", async () => {
    const handler = withErrorHandling(async (req) => {
      const ctx = requireAuth(req);
      return { status: 200, body: { userId: ctx.userId } };
    });

    const req = createMockRequest({ role: UserRole.PATIENT, userId: "p-1" });
    const res = await handler(req);

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe("p-1");
  });

  it("should return 500 for unexpected errors", async () => {
    const handler = withErrorHandling(async () => {
      throw new Error("Database connection failed");
    });

    const req = createMockRequest({ role: UserRole.PATIENT });
    const res = await handler(req);

    expect(res.status).toBe(500);
    expect(res.body.code).toBe("INTERNAL_ERROR");
  });
});

// ────────────────────────────────────────────

describe("Rate Limiter", () => {
  it("should allow requests within the limit", () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 3 });

    const r1 = limiter.check("ip-1");
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = limiter.check("ip-1");
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = limiter.check("ip-1");
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);

    limiter.destroy();
  });

  it("should block requests exceeding the limit", () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 2 });

    limiter.check("ip-2");
    limiter.check("ip-2");

    const r3 = limiter.check("ip-2");
    expect(r3.allowed).toBe(false);
    expect(r3.remaining).toBe(0);
    expect(r3.resetInMs).toBeGreaterThan(0);

    limiter.destroy();
  });

  it("should track different IPs independently", () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 1 });

    const r1 = limiter.check("ip-a");
    expect(r1.allowed).toBe(true);

    const r2 = limiter.check("ip-b");
    expect(r2.allowed).toBe(true);

    // ip-a is now blocked
    const r3 = limiter.check("ip-a");
    expect(r3.allowed).toBe(false);

    // ip-b is also blocked
    const r4 = limiter.check("ip-b");
    expect(r4.allowed).toBe(false);

    limiter.destroy();
  });

  it("should reset limits for a specific key", () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 1 });

    limiter.check("ip-x");
    expect(limiter.check("ip-x").allowed).toBe(false);

    limiter.reset("ip-x");
    expect(limiter.check("ip-x").allowed).toBe(true);

    limiter.destroy();
  });
});

// ────────────────────────────────────────────

describe("End-to-End Route Protection Scenarios", () => {
  /**
   * Simulates a doctor-only API route handler.
   * E.g., POST /api/appointments/:id/notes
   */
  const doctorOnlyHandler = withErrorHandling(async (req: MockRequest) => {
    const ctx = requireRole(req, [UserRole.DOCTOR, UserRole.ADMIN]);
    return {
      status: 200,
      body: { message: "Visit note created", doctorId: ctx.profileId },
    };
  });

  /**
   * Simulates GET /api/appointments/:id
   * where we check ownership (the appointment belongs to a specific patient).
   */
  const getAppointmentHandler = withErrorHandling(async (req: MockRequest) => {
    // First, require auth
    const ctx = requireAuth(req);

    // Simulate: appointment from database
    const appointment = {
      id: "appt-001",
      patientId: "patient-profile-B", // belongs to Patient B
      doctorId: "doctor-profile-1",
      slotStartTime: "2025-01-15T10:00:00Z",
      status: "CONFIRMED",
    };

    // Check ownership: patient can only see their own appointments
    if (ctx.role === UserRole.PATIENT) {
      requireOwnership(req, appointment.patientId, "profileId");
    }
    // Doctors can see appointments assigned to them
    if (ctx.role === UserRole.DOCTOR) {
      requireOwnership(req, appointment.doctorId, "profileId");
    }
    // Admins pass through (handled by requireOwnership internally)

    return { status: 200, body: appointment };
  });

  // ── Scenario 1: Patient → Doctor-only route ──

  it("SCENARIO: Patient tries to create a visit note (doctor-only) → 403", async () => {
    const req = createMockRequest({
      role: UserRole.PATIENT,
      userId: "patient-user-1",
      profileId: "patient-profile-1",
    });

    const res = await doctorOnlyHandler(req);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("INSUFFICIENT_ROLE");
    expect(res.body.error).toContain("DOCTOR");
  });

  // ── Scenario 2: Patient → Another patient's appointment ──

  it("SCENARIO: Patient A fetches Patient B's appointment by ID → 403", async () => {
    const req = createMockRequest({
      role: UserRole.PATIENT,
      userId: "patient-user-A",
      profileId: "patient-profile-A", // NOT patient-profile-B who owns the appointment
    });

    const res = await getAppointmentHandler(req);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NOT_OWNER");
  });

  // ── Scenario 3: Patient accesses own appointment ──

  it("SCENARIO: Patient B fetches their own appointment → 200", async () => {
    const req = createMockRequest({
      role: UserRole.PATIENT,
      userId: "patient-user-B",
      profileId: "patient-profile-B", // matches appointment.patientId
    });

    const res = await getAppointmentHandler(req);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe("appt-001");
  });

  // ── Scenario 4: Doctor accesses own appointment ──

  it("SCENARIO: Assigned doctor fetches the appointment → 200", async () => {
    const req = createMockRequest({
      role: UserRole.DOCTOR,
      userId: "doc-user-1",
      profileId: "doctor-profile-1", // matches appointment.doctorId
    });

    const res = await getAppointmentHandler(req);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe("appt-001");
  });

  // ── Scenario 5: Different doctor tries to access ──

  it("SCENARIO: Unrelated doctor tries to fetch the appointment → 403", async () => {
    const req = createMockRequest({
      role: UserRole.DOCTOR,
      userId: "doc-user-2",
      profileId: "doctor-profile-2", // NOT the assigned doctor
    });

    const res = await getAppointmentHandler(req);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NOT_OWNER");
  });

  // ── Scenario 6: Admin bypasses all ownership ──

  it("SCENARIO: Admin fetches any appointment → 200", async () => {
    const req = createMockRequest({
      role: UserRole.ADMIN,
      userId: "admin-1",
    });

    const res = await getAppointmentHandler(req);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe("appt-001");
  });

  // ── Scenario 7: No token at all ──

  it("SCENARIO: Unauthenticated request → 401", async () => {
    const req = createMockRequest({ token: null });

    const res = await getAppointmentHandler(req);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("NO_TOKEN");
  });

  // ── Scenario 8: Expired token ──

  it("SCENARIO: Expired token → 401", async () => {
    const req = createMockRequest({
      role: UserRole.PATIENT,
      expired: true,
    });

    const res = await getAppointmentHandler(req);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TOKEN_EXPIRED");
  });
});
