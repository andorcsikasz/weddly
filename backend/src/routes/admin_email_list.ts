// Read-only admin endpoint: all collected emails across every source table.
// Entries are never deletable from this surface -- the raw source rows (users,
// guests, vendor_waitlist, planner_waitlist, vendor_accounts) have their own
// lifecycle, but the list itself is append-only from the admin's perspective.
//
// Demo accounts are excluded. Every demo owner/vendor/planner is seeded under
// the `%@demo.weddly.local` address (see demo_seed.ts), which is the same
// marker the analytics and directory queries already filter on, so a throwaway
// "Try the demo" seed can never leak into a real outreach export.

import type { AdminEmailEntry, AdminEmailListResponse, AdminEmailSourceType } from "@shared/types";
import { db } from "../db";
import { requireAdmin } from "../domain/users";
import { type Ctx, json, type Router } from "../lib/http";

interface EmailRow {
  email: string;
  source_type: AdminEmailSourceType;
  name: string | null;
  added_at: number;
  meta: string | null;
}

function toEntry(row: EmailRow): AdminEmailEntry {
  return {
    email: row.email,
    source_type: row.source_type,
    name: row.name,
    added_at: row.added_at,
    meta: row.meta,
  };
}

function collectEmails(): EmailRow[] {
  const out: EmailRow[] = [];

  // ── Registered users ────────────────────────────────────────────────────────
  const users = db
    .query<{ email: string; full_name: string; created_at: number; role: string }, []>(
      `SELECT email, full_name, created_at, role
       FROM users
       WHERE status != 'suspended'
         AND email NOT LIKE '%@demo.weddly.local'
       ORDER BY created_at DESC`,
    )
    .all();
  for (const u of users) {
    out.push({
      email: u.email,
      source_type: u.role === "vendor" ? "vendor" : "user",
      name: u.full_name,
      added_at: u.created_at,
      meta: u.role,
    });
  }

  // ── Wedding guests with emails ───────────────────────────────────────────────
  const guests = db
    .query<
      { email: string; full_name: string; created_at: number; couple_slug: string | null },
      []
    >(
      `SELECT g.email, g.full_name, g.created_at, c.slug AS couple_slug
       FROM guests g
       LEFT JOIN couples c ON c.id = g.couple_id
       WHERE g.email IS NOT NULL AND g.email != ''
         AND g.email NOT LIKE '%@demo.weddly.local'
         AND COALESCE(c.is_demo, 0) = 0
       ORDER BY g.created_at DESC`,
    )
    .all();
  for (const g of guests) {
    out.push({
      email: g.email,
      source_type: "guest",
      name: g.full_name,
      added_at: g.created_at,
      meta: g.couple_slug,
    });
  }

  // ── Vendor waitlist ──────────────────────────────────────────────────────────
  const vendorWaitlist = db
    .query<{ email: string; business_name: string; created_at: number; category: string }, []>(
      `SELECT email, business_name, created_at, category
       FROM vendor_waitlist
       WHERE email NOT LIKE '%@demo.weddly.local'
       ORDER BY created_at DESC`,
    )
    .all();
  for (const v of vendorWaitlist) {
    out.push({
      email: v.email,
      source_type: "vendor_waitlist",
      name: v.business_name,
      added_at: v.created_at,
      meta: v.category,
    });
  }

  // ── Planner waitlist ─────────────────────────────────────────────────────────
  const plannerWaitlist = db
    .query<{ email: string; full_name: string; created_at: number; city: string | null }, []>(
      `SELECT email, full_name, created_at, city
       FROM planner_waitlist
       WHERE email NOT LIKE '%@demo.weddly.local'
       ORDER BY created_at DESC`,
    )
    .all();
  for (const p of plannerWaitlist) {
    out.push({
      email: p.email,
      source_type: "planner_waitlist",
      name: p.full_name,
      added_at: p.created_at,
      meta: p.city,
    });
  }

  return out;
}

export function registerAdminEmailListRoutes(router: Router) {
  router.get("/api/admin/email-list", (ctx: Ctx) => {
    requireAdmin(ctx);

    const raw = collectEmails();

    // Deduplicate by email, keeping the earliest added_at and the most
    // informative source type (user > vendor > guest > waitlists).
    const SOURCE_RANK: Record<AdminEmailSourceType, number> = {
      user: 0,
      vendor: 1,
      guest: 2,
      vendor_waitlist: 3,
      planner_waitlist: 4,
    };

    const byEmail = new Map<string, EmailRow>();
    for (const row of raw) {
      const key = row.email.toLowerCase();
      const existing = byEmail.get(key);
      if (!existing) {
        byEmail.set(key, row);
      } else {
        // Keep the higher-ranked source type; break ties by earliest added_at.
        if (SOURCE_RANK[row.source_type] < SOURCE_RANK[existing.source_type]) {
          byEmail.set(key, { ...row, added_at: Math.min(row.added_at, existing.added_at) });
        } else if (row.added_at < existing.added_at) {
          byEmail.set(key, { ...existing, added_at: row.added_at });
        }
      }
    }

    const entries = Array.from(byEmail.values())
      .sort((a, b) => b.added_at - a.added_at)
      .map(toEntry);

    return json({ entries, total: entries.length });
  });
}
