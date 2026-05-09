// User row → DTO mapper, plus tiny lookup helpers.

import type { User, UserRole, UserStatus } from "@shared/types";
import { db } from "../db";

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  full_name: string;
  status: string;
  role: string;
  couple_id: number | null;
  verified_email: number;
  created_at: number;
  updated_at: number;
}

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    status: row.status as UserStatus,
    role: row.role as UserRole,
    couple_id: row.couple_id,
    verified_email: Boolean(row.verified_email),
    created_at: row.created_at,
  };
}

export function getUserById(id: number): UserRow | null {
  return (db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined) ?? null;
}

export function getUserByEmail(email: string): UserRow | null {
  const norm = email.trim().toLowerCase();
  return (
    (db.prepare("SELECT * FROM users WHERE email = ?").get(norm) as UserRow | undefined) ?? null
  );
}
