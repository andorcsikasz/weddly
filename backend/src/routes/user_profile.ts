// PATCH /api/users/me — lets a signed-in user edit their own display
// name and persisted UI locale. Split out from auth.ts (credentials) and
// user_couple.ts (membership) so each file owns a single concern.
//
// The DTO that comes back is the same `User` shape `/api/auth/me` returns,
// so the frontend can drop it straight into the auth store after a PATCH.

import { checkRealName } from "@shared/real_names";
import type { User } from "@shared/types";
import { db, now } from "../db";
import { getUserById, toUser } from "../domain/users";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";

interface UpdateMeBody {
  full_name?: unknown;
  locale?: unknown;
}

function parseOptionalFullName(raw: unknown, isPerson: boolean): string | null {
  if (raw === undefined) return null;
  if (typeof raw !== "string") throw new HttpError(400, "Name must be a string");
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > 200) {
    throw new HttpError(400, "Name must be 1–200 characters");
  }
  // Same gate as registration, and for the same reason: without it the rule is
  // a speed bump, since you could sign up as a person and rename to "asdf" one
  // PATCH later.
  //
  // Couples only, though. A vendor's or planner's `full_name` is routinely
  // their BUSINESS name, and a business name is not a person name: production
  // holds "Dream Wedding Film" and "Esküvői Weboldalam", and "Bride & Groom
  // Photography" is an entirely ordinary thing to call a studio.
  if (!isPerson) return trimmed;
  const verdict = checkRealName(trimmed);
  if (verdict) {
    throw new HttpError(400, "Name does not look like a real name", {
      code: "placeholder_name",
      field: "full_name",
      reason: verdict.reason,
    });
  }
  return trimmed;
}

function parseOptionalLocale(raw: unknown): "hu" | "en" | null | undefined {
  // Three states: undefined (no change), null (clear → fall back to
  // client detection), "hu" / "en" (set explicit preference).
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (raw === "hu" || raw === "en") return raw;
  throw new HttpError(400, "Locale must be 'hu', 'en', or null");
}

async function handleUpdateMe(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const body = await readJson<UpdateMeBody>(ctx.req);
  const current = getUserById(userId);
  if (!current) throw new HttpError(404, "User not found");
  // A couple member is a person; a vendor or planner is usually a business.
  const isPerson = current.role !== "vendor" && current.user_type !== "planner";
  const nextName = parseOptionalFullName(body.full_name, isPerson);
  const nextLocale = parseOptionalLocale(body.locale);

  if (nextName === null && nextLocale === undefined) {
    // No-op patch — return the current state so clients don't need to
    // special-case "did anything actually change?".
    const row = getUserById(userId);
    if (!row) throw new HttpError(404, "User not found");
    return json({ user: toUser(row) });
  }

  const sets: string[] = [];
  const args: Array<string | number | null> = [];
  if (nextName !== null) {
    sets.push("full_name = ?");
    args.push(nextName);
  }
  if (nextLocale !== undefined) {
    sets.push("locale = ?");
    args.push(nextLocale);
  }
  sets.push("updated_at = ?");
  args.push(now());
  args.push(userId);

  db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...args);

  const fresh = getUserById(userId);
  if (!fresh) throw new HttpError(500, "User vanished after profile update");
  return json({ user: toUser(fresh) });
}

export function registerUserProfileRoutes(router: Router) {
  router.patch("/api/users/me", handleUpdateMe, true);
}
