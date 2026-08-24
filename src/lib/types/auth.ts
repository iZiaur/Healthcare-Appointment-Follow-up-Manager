// ============================================================================
// Auth Types — Shared type definitions for the auth system
// ============================================================================

import { UserRole } from "@prisma/client";

// ── JWT Payload (what's encoded in the access token) ──

export interface JwtPayload {
  sub: string;         // User ID
  email: string;
  role: UserRole;
  profileId?: string;  // DoctorProfile.id or PatientProfile.id
  iat?: number;
  exp?: number;
}

// ── API Request/Response types ──

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
  phone?: string;
  role: "PATIENT" | "DOCTOR";
  // Doctor-specific fields (required when role === "DOCTOR")
  specialization?: string;
  qualification?: string;
  experience?: number;
  consultationFee?: number;
  slotDuration?: number;
  bio?: string;
  // Patient-specific fields
  dateOfBirth?: string;
  gender?: "MALE" | "FEMALE" | "OTHER";
  bloodGroup?: string;
  allergies?: string;
  address?: string;
  emergencyContact?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;   // seconds until access token expires
}

export interface AuthResponse {
  user: {
    id: string;
    email: string;
    name: string;
    role: UserRole;
    profileId?: string;
  };
  tokens: AuthTokens;
}

// ── Authenticated request context ──

export interface AuthContext {
  userId: string;
  email: string;
  role: UserRole;
  profileId?: string;
}

// ── Middleware types ──

export type RouteHandler = (req: MockRequest) => Promise<MockResponse>;

export interface MockRequest {
  headers: Record<string, string | undefined>;
  body?: any;
  params?: Record<string, string>;
  query?: Record<string, string>;
  method?: string;
  url?: string;
  ip?: string;
}

export interface MockResponse {
  status: number;
  body: any;
  headers?: Record<string, string>;
}

// ── Error types ──

export class AuthError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = "AuthError";
  }
}
