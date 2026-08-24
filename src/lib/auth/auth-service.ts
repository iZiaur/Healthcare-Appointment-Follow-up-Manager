// ============================================================================
// Auth Service — Registration, Login, Token Refresh, Logout
// ============================================================================
//
// Business logic for authentication flows. This module is framework-agnostic
// and works with any HTTP framework (Next.js, Express, etc.).
//
// Key behaviors:
//   - Registration creates User + role-specific profile in a transaction
//   - Login validates credentials and returns access + refresh tokens
//   - Refresh rotates the refresh token (old one revoked, new one issued)
//   - Replay detection: if a revoked token is reused, all tokens for that
//     user are revoked (potential token theft)
//   - Admin accounts can ONLY be seeded, never self-registered
// ============================================================================

import { PrismaClient, UserRole } from "@prisma/client";
import { hashPassword, verifyPassword } from "./password";
import {
  signAccessToken,
  createTokenPair,
  generateRefreshToken,
  getRefreshTokenExpiry,
} from "./jwt";
import type {
  RegisterRequest,
  LoginRequest,
  AuthResponse,
  AuthTokens,
  JwtPayload,
} from "../types/auth";
import { AuthError } from "../types/auth";

export class AuthService {
  constructor(private prisma: PrismaClient) {}

  // ── REGISTER ──

  async register(data: RegisterRequest): Promise<AuthResponse> {
    // 1. Block admin self-registration
    if ((data.role as string) === "ADMIN") {
      throw new AuthError(403, "Admin accounts cannot be self-registered", "ADMIN_REGISTRATION_BLOCKED");
    }

    // 2. Validate role-specific required fields
    if (data.role === "DOCTOR") {
      if (!data.specialization || !data.qualification) {
        throw new AuthError(400, "Doctors must provide specialization and qualification", "MISSING_DOCTOR_FIELDS");
      }
    }

    // 3. Check for existing user
    const existing = await this.prisma.user.findUnique({
      where: { email: data.email },
    });
    if (existing) {
      throw new AuthError(409, "Email already registered", "EMAIL_EXISTS");
    }

    // 4. Hash password
    const passwordHash = await hashPassword(data.password);

    // 5. Create user + profile in a transaction
    const user = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: data.email,
          passwordHash,
          name: data.name,
          phone: data.phone,
          role: data.role as UserRole,
          isActive: true,
          // Create role-specific profile inline
          ...(data.role === "DOCTOR"
            ? {
                doctorProfile: {
                  create: {
                    specialization: data.specialization!,
                    qualification: data.qualification!,
                    experience: data.experience ?? 0,
                    consultationFee: data.consultationFee ?? 0,
                    slotDuration: data.slotDuration ?? 30,
                    bio: data.bio,
                  },
                },
              }
            : {
                patientProfile: {
                  create: {
                    dateOfBirth: data.dateOfBirth
                      ? new Date(data.dateOfBirth)
                      : undefined,
                    gender: data.gender as any,
                    bloodGroup: data.bloodGroup,
                    allergies: data.allergies,
                    address: data.address,
                    emergencyContact: data.emergencyContact,
                  },
                },
              }),
        },
        include: {
          doctorProfile: true,
          patientProfile: true,
        },
      });

      return newUser;
    });

    // 6. Generate tokens
    const profileId =
      user.doctorProfile?.id ?? user.patientProfile?.id;

    const jwtPayload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      profileId,
    };

    const tokens = createTokenPair(jwtPayload);

    // 7. Store refresh token in DB
    await this.prisma.refreshToken.create({
      data: {
        token: tokens.refreshToken,
        userId: user.id,
        expiresAt: getRefreshTokenExpiry(),
      },
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        profileId,
      },
      tokens,
    };
  }

  // ── LOGIN ──

  async login(data: LoginRequest): Promise<AuthResponse> {
    // 1. Find user by email
    const user = await this.prisma.user.findUnique({
      where: { email: data.email },
      include: {
        doctorProfile: true,
        patientProfile: true,
      },
    });

    if (!user) {
      // Use generic message to prevent email enumeration
      throw new AuthError(401, "Invalid email or password", "INVALID_CREDENTIALS");
    }

    // 2. Check if account is active
    if (!user.isActive) {
      throw new AuthError(403, "Account has been deactivated", "ACCOUNT_DEACTIVATED");
    }

    // 3. Verify password
    const isValidPassword = await verifyPassword(
      data.password,
      user.passwordHash
    );
    if (!isValidPassword) {
      throw new AuthError(401, "Invalid email or password", "INVALID_CREDENTIALS");
    }

    // 4. Generate tokens
    const profileId =
      user.doctorProfile?.id ?? user.patientProfile?.id;

    const jwtPayload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      profileId,
    };

    const tokens = createTokenPair(jwtPayload);

    // 5. Store refresh token
    await this.prisma.refreshToken.create({
      data: {
        token: tokens.refreshToken,
        userId: user.id,
        expiresAt: getRefreshTokenExpiry(),
      },
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        profileId,
      },
      tokens,
    };
  }

  // ── REFRESH TOKEN ROTATION ──

  async refreshTokens(oldRefreshToken: string): Promise<AuthTokens> {
    // 1. Find the refresh token in DB
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { token: oldRefreshToken },
      include: {
        user: {
          include: {
            doctorProfile: true,
            patientProfile: true,
          },
        },
      },
    });

    if (!storedToken) {
      throw new AuthError(401, "Invalid refresh token", "INVALID_REFRESH_TOKEN");
    }

    // 2. Check if token was already revoked (replay attack detection)
    if (storedToken.revokedAt) {
      // SECURITY: This token was already used. This could be a replay attack.
      // Revoke ALL tokens for this user as a precaution.
      await this.prisma.refreshToken.updateMany({
        where: { userId: storedToken.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new AuthError(401, "Refresh token reuse detected — all sessions revoked", "TOKEN_REUSE_DETECTED");
    }

    // 3. Check if token is expired
    if (storedToken.expiresAt < new Date()) {
      // Mark as revoked for audit trail
      await this.prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: { revokedAt: new Date() },
      });
      throw new AuthError(401, "Refresh token expired", "REFRESH_TOKEN_EXPIRED");
    }

    // 4. Check if user is still active
    if (!storedToken.user.isActive) {
      throw new AuthError(403, "Account has been deactivated", "ACCOUNT_DEACTIVATED");
    }

    // 5. Generate new token pair
    const profileId =
      storedToken.user.doctorProfile?.id ??
      storedToken.user.patientProfile?.id;

    const jwtPayload: JwtPayload = {
      sub: storedToken.user.id,
      email: storedToken.user.email,
      role: storedToken.user.role,
      profileId,
    };

    const newTokens = createTokenPair(jwtPayload);

    // 6. Rotate: revoke old token, store new one (in a transaction)
    await this.prisma.$transaction([
      // Revoke old token and link to new one
      this.prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: {
          revokedAt: new Date(),
          replacedByToken: newTokens.refreshToken,
        },
      }),
      // Store new token
      this.prisma.refreshToken.create({
        data: {
          token: newTokens.refreshToken,
          userId: storedToken.userId,
          expiresAt: getRefreshTokenExpiry(),
        },
      }),
    ]);

    return newTokens;
  }

  // ── LOGOUT ──

  async logout(refreshToken: string): Promise<void> {
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
    });

    if (storedToken && !storedToken.revokedAt) {
      await this.prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: { revokedAt: new Date() },
      });
    }
  }

  /**
   * Revoke all refresh tokens for a user (e.g., password change, admin action).
   */
  async revokeAllUserTokens(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
