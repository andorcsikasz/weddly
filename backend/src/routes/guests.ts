// Guest list CRUD + CSV import. All endpoints couple-scoped.

import type {
  DietarySummary,
  Guest,
  GuestGroupTag,
  GuestKind,
  MealChoice,
  RsvpStatus,
} from "@shared/types";
import { CONFIG } from "../config";
import { db, now } from "../db";
import { addAuditLog } from "../lib/audit";
import { getCoupleForUser } from "../domain/couples";
import { sendKind } from "../domain/emails";
import { recordExport } from "../domain/exports";
import { indexHeaders, parseCsv } from "../lib/csv";
import {
  type GuestRow,
  getGuestByIdScoped,
  isGuestGroupTag,
  isGuestKind,
  isMealChoice,
  isRsvpStatus,
  listGuestsByCouple,
  toGuest,
  uniqueInviteCode,
} from "../domain/guests";
import { purgeHouseholdIfEmpty } from "../domain/household_cleanup";
import {
  createHousehold,
  getHouseholdById,
  getOrCreateSupplierHousehold,
} from "../domain/households";
import { getUserById } from "../domain/users";
import {
  type Ctx,
  HttpError,
  json,
  readJson,
  requireAuth,
  requireVerifiedAuth,
  type Router,
} from "../lib/http";

interface UpsertBody {
  full_name?: unknown;
  email?: unknown;
  phone?: unknown;
  group_tag?: unknown;
  kind?: unknown;
  /** Boolean — marks/unmarks the guest as a supplier. Omitted = false. */
  is_supplier?: unknown;
  rsvp_status?: unknown;
  meal_choice?: unknown;
  dietary?: unknown;
  plus_one_name?: unknown;
  plus_one_meal?: unknown;
  /** Guest id this guest is a "+1" of. A number turns the guest into an
   *  explicit +1 of that host (same household, RSVP-suppressed); `null`
   *  detaches an existing +1 back to a standalone guest. Omitted = no change. */
  plus_one_of?: unknown;
  accommodation_needed?: unknown;
  song_request?: unknown;
  notes?: unknown;
  /** Boolean — `true` marks the guest as invited at the current timestamp;
   *  `false` clears it. Omitted = leave invited_at as-is. */
  invited?: unknown;
  /** Boolean — `true` stamps invitation_delivered_at to now (and ensures
   *  invited_at is also set, since delivered implies invited); `false` clears
   *  only the delivered timestamp. Omitted = leave as-is. */
  delivered?: unknown;
  /** Boolean — per-channel invite tracking. `true` stamps `invited_online_at`
   *  (and `invited_at` if unset, to keep the legacy chip in sync); `false`
   *  clears `invited_online_at`. Omitted = leave as-is. */
  invited_online?: unknown;
  /** Boolean — per-channel invite tracking. `true` stamps `invited_physical_at`
   *  (plus `invitation_delivered_at`, and `invited_at` if unset); `false` clears
   *  `invited_physical_at`. Omitted = leave as-is. */
  invited_physical?: unknown;
  /** Boolean — `true` and `email` present: fire a `guest_invite` email with a
   *  one-click /rsvp/{invite_code} link. Also stamps `invited_at` so the
   *  guest row's status badge moves to "invited" in the UI. Silently ignored
   *  when no email is on the guest or the flag is false. Create-only — for
   *  resends, use the dedicated endpoint (TODO when it lands). */
  send_invite?: unknown;
  /** Household this guest belongs to. If omitted on create, the server
   *  spawns a household-of-one with the guest's name as its label. */
  household_id?: unknown;
  /** Used together with `household_id === null` to create a brand-new
   *  household and put this guest in it (e.g. "Kovács family"). */
  new_household_label?: unknown;
  /** Create-only opt-in for the new household's `rsvp_offers_accommodation`
   *  flag. Ignored unless the request actually spawns a new household via
   *  `new_household_label`. */
  new_household_offers_accommodation?: unknown;
}

interface ParsedGuest {
  full_name: string;
  email: string | null;
  phone: string | null;
  group_tag: GuestGroupTag;
  kind: GuestKind;
  is_supplier: number;
  rsvp_status: RsvpStatus;
  meal_choice: MealChoice | null;
  dietary: string | null;
  plus_one_name: string | null;
  plus_one_meal: MealChoice | null;
  /** undefined = caller didn't touch the +1 link; number = assign to that host;
   *  null = detach an existing +1. */
  plus_one_of: number | null | undefined;
  accommodation_needed: number;
  song_request: string | null;
  notes: string | null;
}

function parseStr(raw: unknown, max = 500): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw new HttpError(400, `Field longer than ${max} chars`);
  return trimmed;
}

function parseGroupTag(raw: unknown): GuestGroupTag {
  if (typeof raw === "string" && isGuestGroupTag(raw)) return raw;
  return "other";
}

function parseKind(raw: unknown): GuestKind {
  if (typeof raw === "string" && isGuestKind(raw)) return raw;
  return "adult";
}

/** Resolve + validate the host a "+1" is assigned to. A host must be a real
 *  guest in this couple that isn't itself a +1 (no chains), isn't a supplier,
 *  and isn't the guest being saved. Returns the host row so the +1 inherits its
 *  household + group_tag. */
function resolvePlusOneHost(coupleId: number, hostId: number, selfId: number | null): GuestRow {
  if (selfId !== null && hostId === selfId) {
    throw new HttpError(400, "A +1 cannot be assigned to itself");
  }
  const host = getGuestByIdScoped(hostId, coupleId);
  if (!host) throw new HttpError(400, "plus_one_of host not found in this couple");
  if (host.is_plus_one) throw new HttpError(400, "A +1 cannot host another +1");
  if (host.is_supplier) throw new HttpError(400, "A supplier cannot host a +1");
  if (host.household_id === null) throw new HttpError(400, "Host has no household");
  return host;
}

function parseRsvp(raw: unknown): RsvpStatus {
  if (typeof raw === "string" && isRsvpStatus(raw)) return raw;
  return "pending";
}

function parseMeal(raw: unknown): MealChoice | null {
  if (typeof raw !== "string") return null;
  return isMealChoice(raw) ? raw : null;
}

/**
 * The UPDATE below writes every column, so a PATCH that omits a field would
 * blank it: `{invited_online: true}` alone used to resolve to an empty name, no
 * email, no phone, rsvp back to "pending". Only the `full_name required` throw
 * stood between a partial PATCH and a wiped guest, which is why the invite
 * page's channel toggle answered "Something went wrong" instead of destroying
 * the row. Merging against `existing` is what makes the endpoint honest, and it
 * is what lets a caller send the one field it means to change.
 *
 * `undefined` means ABSENT and keeps the stored value; an explicit `null` or ""
 * still clears, because that is a caller saying "remove this".
 */
function parseUpsert(body: UpsertBody, requireName = true, existing?: GuestRow): ParsedGuest {
  const keep = <T>(raw: unknown, current: T, parse: () => T): T =>
    existing && raw === undefined ? current : parse();

  const fullName = keep(body.full_name, existing?.full_name ?? null, () =>
    parseStr(body.full_name, 200),
  );
  if (requireName && !fullName) throw new HttpError(400, "full_name required");

  return {
    full_name: fullName ?? "",
    email: keep(body.email, existing?.email ?? null, () => parseStr(body.email, 320)),
    phone: keep(body.phone, existing?.phone ?? null, () => parseStr(body.phone, 64)),
    group_tag: keep(body.group_tag, (existing?.group_tag ?? "other") as GuestGroupTag, () =>
      parseGroupTag(body.group_tag),
    ),
    kind: keep(body.kind, (existing?.kind ?? "adult") as GuestKind, () => parseKind(body.kind)),
    is_supplier: keep(body.is_supplier, existing?.is_supplier ?? 0, () =>
      body.is_supplier ? 1 : 0,
    ),
    rsvp_status: keep(body.rsvp_status, (existing?.rsvp_status ?? "pending") as RsvpStatus, () =>
      parseRsvp(body.rsvp_status),
    ),
    meal_choice: keep(body.meal_choice, (existing?.meal_choice ?? null) as MealChoice | null, () =>
      parseMeal(body.meal_choice),
    ),
    dietary: keep(body.dietary, existing?.dietary ?? null, () => parseStr(body.dietary, 500)),
    plus_one_name: keep(body.plus_one_name, existing?.plus_one_name ?? null, () =>
      parseStr(body.plus_one_name, 200),
    ),
    plus_one_meal: keep(
      body.plus_one_meal,
      (existing?.plus_one_meal ?? null) as MealChoice | null,
      () => parseMeal(body.plus_one_meal),
    ),
    // Omitted → undefined (no change); explicit null → detach; finite number →
    // assign to that host. NaN/garbage is treated as "no change".
    plus_one_of:
      body.plus_one_of === undefined
        ? undefined
        : body.plus_one_of === null
          ? null
          : typeof body.plus_one_of === "number" && Number.isFinite(body.plus_one_of)
            ? body.plus_one_of
            : undefined,
    accommodation_needed: keep(
      body.accommodation_needed,
      existing?.accommodation_needed ?? 0,
      () => (body.accommodation_needed ? 1 : 0),
    ),
    song_request: keep(body.song_request, existing?.song_request ?? null, () =>
      parseStr(body.song_request, 500),
    ),
    notes: keep(body.notes, existing?.notes ?? null, () => parseStr(body.notes, 2000)),
  };
}

function handleList(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  // Optional search + pagination + group-tag filter. Frontend can opt in
  // incrementally — when none of these are provided, the response is
  // identical to v1 (full list).
  const q = (ctx.url.searchParams.get("q") ?? "").trim().toLowerCase();
  const limitRaw = ctx.url.searchParams.get("limit");
  const offsetRaw = ctx.url.searchParams.get("offset");
  const groupTagRaw = ctx.url.searchParams.get("group_tag");
  const limit =
    limitRaw === null || limitRaw === "" ? null : Math.max(1, Math.min(1000, Number(limitRaw)));
  const offset = offsetRaw === null || offsetRaw === "" ? 0 : Math.max(0, Number(offsetRaw));
  if (limit !== null && !Number.isFinite(limit)) throw new HttpError(400, "limit invalid");
  if (!Number.isFinite(offset)) throw new HttpError(400, "offset invalid");
  // Unknown group_tag → 400 rather than silently returning everything (which
  // looks like the filter worked but didn't, the bug a 100-persona betatest
  // pass surfaced as "query param ignored").
  let groupTag: GuestGroupTag | null = null;
  if (groupTagRaw !== null && groupTagRaw !== "") {
    if (!isGuestGroupTag(groupTagRaw)) throw new HttpError(400, "group_tag invalid");
    groupTag = groupTagRaw;
  }

  let all = listGuestsByCouple(couple.id);
  if (groupTag !== null) {
    all = all.filter((g) => g.group_tag === groupTag);
  }
  if (q) {
    all = all.filter((g) => {
      const name = g.full_name.toLowerCase();
      const email = (g.email ?? "").toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }
  const total = all.length;
  let guests = all;
  if (limit !== null || offset > 0) {
    guests = all.slice(offset, limit === null ? undefined : offset + limit);
  }
  if (q || groupTag !== null || limit !== null || offset > 0) {
    return json({ guests, total });
  }
  return json({ guests });
}

/** Resolve the household the new guest will live in.
 *
 *  Returns the household id + the group_tag the guest must inherit. The group
 *  is the source-of-truth for the whole household — when the body picks an
 *  existing household, the guest takes that household's group_tag; when the
 *  body spawns a new household (explicit or implicit), the new household is
 *  seeded with the guest's own group_tag so the household + member stay in
 *  lock-step from the first row. */
function resolveHouseholdForCreate(
  body: UpsertBody,
  coupleId: number,
  guestName: string,
  guestGroupTag: GuestGroupTag,
): { id: number; group_tag: GuestGroupTag } {
  if (typeof body.household_id === "number" && Number.isFinite(body.household_id)) {
    const hh = getHouseholdById(body.household_id, coupleId);
    if (!hh) throw new HttpError(400, "household_id not found in this couple");
    const tag: GuestGroupTag = isGuestGroupTag(hh.group_tag) ? hh.group_tag : "other";
    return { id: hh.id, group_tag: tag };
  }
  // Either an explicit "new household with label X" intent, or implicit
  // household-of-one named after the guest. The new household is created with
  // the guest's chosen group_tag. We tag the implicit case as `auto_created`
  // so the household tab can optionally hide stub singletons — an explicit
  // `new_household_label` means the user deliberately created the row and
  // expects to see it in the household list.
  const labelRaw =
    typeof body.new_household_label === "string" ? body.new_household_label.trim() : "";
  const autoCreated = labelRaw === "";
  const label = labelRaw || guestName;
  // Only honour the accommodation opt-in for explicit new-household creates —
  // the auto-spawned household-of-one path is a backend convenience and
  // shouldn't pick up an RSVP-form flag the user never saw a toggle for.
  const offersAccommodation = !autoCreated && body.new_household_offers_accommodation === true;
  const created = createHousehold({
    couple_id: coupleId,
    label,
    group_tag: guestGroupTag,
    auto_created: autoCreated,
    rsvp_offers_accommodation: offersAccommodation,
  });
  return { id: created.id, group_tag: guestGroupTag };
}

/** Turn a filled-in "+1" into a real guest row — a plain adult in the same
 *  household as the parent, RSVP pending, fully editable afterwards. The couple
 *  fills the plus-one on the guest's behalf; we materialise it rather than
 *  keeping a soft `plus_one_name` string so it shows up in counts/seating. The
 *  caller is responsible for clearing the parent's carrier columns so a re-save
 *  doesn't duplicate. */
function materializePlusOne(
  coupleId: number,
  parent: { id: number; household_id: number | null; group_tag: string },
  name: string,
  meal: MealChoice | null,
  userId: number,
): void {
  const ts = now();
  const res = db
    .prepare(
      `INSERT INTO guests
        (couple_id, full_name, email, phone, group_tag, invite_code, kind, is_supplier, is_plus_one, plus_one_of, rsvp_status,
         meal_choice, dietary, plus_one_name, plus_one_meal, accommodation_needed,
         song_request, notes, rsvp_responded_at, invited_at, invitation_delivered_at,
         created_at, updated_at, household_id)
       VALUES (?, ?, NULL, NULL, ?, ?, 'adult', 0, 1, ?, 'pending', ?, NULL, NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL, ?, ?, ?)`,
    )
    .run(
      coupleId,
      name,
      parent.group_tag,
      uniqueInviteCode(),
      parent.id,
      meal,
      ts,
      ts,
      parent.household_id,
    );
  addAuditLog({
    actor_user_id: userId,
    couple_id: coupleId,
    action: "guest.create",
    target_kind: "guest",
    target_id: Number(res.lastInsertRowid),
    after: {
      full_name: name,
      materialized_plus_one: true,
      plus_one_of: parent.id,
      household_id: parent.household_id,
    },
  });
}

async function handleCreate(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const body = await readJson<UpsertBody>(ctx.req);
  const parsed = parseUpsert(body);
  const ts = now();
  const code = uniqueInviteCode();
  // Suppliers (DJ, photographer, …) are auto-routed to the couple's single
  // supplier household, which takes precedence over the household picker.
  let householdId: number;
  let isPlusOne = 0;
  let plusOneOf: number | null = null;
  if (typeof parsed.plus_one_of === "number") {
    // Explicit "+1" type: assign to a host, inherit its household + group, and
    // force a plain adult (a +1 carries no supplier flag / own +1).
    const host = resolvePlusOneHost(couple.id, parsed.plus_one_of, null);
    isPlusOne = 1;
    plusOneOf = host.id;
    householdId = host.household_id as number;
    parsed.group_tag = isGuestGroupTag(host.group_tag) ? host.group_tag : "other";
    parsed.kind = "adult";
    parsed.is_supplier = 0;
  } else if (parsed.is_supplier) {
    const sh = getOrCreateSupplierHousehold(couple.id, couple.country ?? "HU");
    householdId = sh.id;
    parsed.group_tag = isGuestGroupTag(sh.group_tag) ? sh.group_tag : "other";
  } else {
    const household = resolveHouseholdForCreate(
      body,
      couple.id,
      parsed.full_name,
      parsed.group_tag,
    );
    // Household is the source of truth for group_tag — override the per-guest
    // value the client may have sent. (Matches existing-household join; for new
    // households the resolver already seeded the household with parsed.group_tag.)
    parsed.group_tag = household.group_tag;
    householdId = household.id;
  }
  // Members of the couple's "Suppliers" (Szolgáltatók) household are booked
  // vendors, not invitees waiting to reply. Whether they arrived via the
  // supplier toggle or by being added straight into that household from its
  // card, flag them as suppliers and — unless the request set a status
  // explicitly — count them as a sure participant (RSVP "yes"). The flag is
  // authoritative so it can't drift from the household membership.
  const targetHousehold = getHouseholdById(householdId, couple.id);
  if (targetHousehold?.is_supplier_household === 1) {
    parsed.is_supplier = 1;
    if (body.rsvp_status === undefined) parsed.rsvp_status = "yes";
  }
  // Stamp when the couple records a real answer on the guest's behalf (the
  // public RSVP path stamps separately). Pending stays unstamped.
  const respondedAt = parsed.rsvp_status === "pending" ? null : ts;

  // `invited` / `delivered` are optional — when truthy, the create call stamps
  // both timestamps at `ts`. `delivered=true` implies `invited=true` (you
  // can't physically hand over an invitation that was never marked invited).
  // `send_invite=true` ALSO implies `invited=true` — firing the invite email
  // is itself the invitation, so the guest's status badge moves to invited
  // without the couple needing to flip a second toggle.
  const willSendInvite = body.send_invite === true && parsed.email !== null;
  const deliveredAt = body.delivered === true ? ts : null;
  const invitedAt = body.invited === true || deliveredAt !== null || willSendInvite ? ts : null;
  const result = db
    .prepare(
      `INSERT INTO guests
        (couple_id, full_name, email, phone, group_tag, invite_code, kind, is_supplier, is_plus_one, plus_one_of, rsvp_status,
         meal_choice, dietary, plus_one_name, plus_one_meal, accommodation_needed,
         song_request, notes, rsvp_responded_at, invited_at, invitation_delivered_at,
         created_at, updated_at, household_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      couple.id,
      parsed.full_name,
      parsed.email,
      parsed.phone,
      parsed.group_tag,
      code,
      parsed.kind,
      parsed.is_supplier,
      isPlusOne,
      plusOneOf,
      parsed.rsvp_status,
      parsed.meal_choice,
      parsed.dietary,
      parsed.plus_one_name,
      parsed.plus_one_meal,
      parsed.accommodation_needed,
      parsed.song_request,
      parsed.notes,
      respondedAt,
      invitedAt,
      deliveredAt,
      ts,
      ts,
      householdId,
    );

  const guestId = Number(result.lastInsertRowid);
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "guest.create",
    target_kind: "guest",
    target_id: guestId,
    after: { full_name: parsed.full_name, group_tag: parsed.group_tag, household_id: householdId },
  });

  // A filled-in "+1" becomes a real guest in the same household; clear the
  // carrier so re-saving doesn't duplicate it. Skipped when this guest is
  // itself a +1 — a +1 can't carry its own +1.
  if (!isPlusOne && parsed.plus_one_name) {
    materializePlusOne(
      couple.id,
      { id: guestId, household_id: householdId, group_tag: parsed.group_tag },
      parsed.plus_one_name,
      parsed.plus_one_meal,
      userId,
    );
    db.prepare("UPDATE guests SET plus_one_name = NULL, plus_one_meal = NULL WHERE id = ?").run(
      guestId,
    );
  }

  const row = getGuestByIdScoped(guestId, couple.id) as GuestRow;

  // Fire the invite email AFTER the row + audit log are persisted so a failed
  // mailer (no Resend key in dev, transient 5xx in prod) doesn't roll back
  // the guest create. `sendKind` is fire-and-forget and records its own
  // attempt in `email_log` — the route stays synchronous and fast.
  //
  // We don't have per-guest locale (would need a column the user can edit
  // alongside the address), but the inviting couple's `users.locale` is the
  // best proxy: guests at a wedding are almost always in the same locale
  // bubble as the couple. Surface it on top of the bilingual stack instead
  // of defaulting to HU-on-top for every couple. EN safety net still renders
  // below for the rare cross-locale guest.
  if (willSendInvite && parsed.email) {
    const rsvpUrl = `${CONFIG.frontendBaseUrl}/rsvp/${code}`;
    void sendKind(
      "guest_invite",
      {
        coupleDisplayName: couple.display_name,
        guestName: parsed.full_name,
        weddingDate: couple.wedding_date,
        rsvpUrl,
      },
      {
        user: null,
        guest: { email: parsed.email, full_name: parsed.full_name },
        couple_id: couple.id,
        submitterUserId: userId,
        guestId: row.id,
      },
    );
  }

  return json({ guest: toGuest(row) }, { status: 201 });
}

async function handleUpdate(ctx: Ctx): Promise<Response> {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");

  const existing = getGuestByIdScoped(id, couple.id);
  if (!existing) throw new HttpError(404, "Guest not found");

  const body = await readJson<UpsertBody>(ctx.req);
  // PATCH semantics: anything the caller left out keeps the value it has.
  const parsed = parseUpsert(body, true, existing);
  const ts = now();

  // "+1" link transition. undefined = leave as-is; a number (re)assigns this
  // guest as a +1 of that host; null detaches it back to a standalone guest. A
  // guest that already hosts +1s can't itself become a +1 (no chains).
  let nextIsPlusOne = existing.is_plus_one;
  let nextPlusOneOf = existing.plus_one_of;
  let plusOneHost: GuestRow | null = null;
  if (typeof parsed.plus_one_of === "number") {
    const hosted = db
      .prepare("SELECT COUNT(*) AS n FROM guests WHERE plus_one_of = ? AND couple_id = ?")
      .get(id, couple.id) as { n: number };
    if (hosted.n > 0) throw new HttpError(400, "This guest already hosts a +1");
    plusOneHost = resolvePlusOneHost(couple.id, parsed.plus_one_of, id);
    nextIsPlusOne = 1;
    nextPlusOneOf = plusOneHost.id;
    parsed.kind = "adult";
    parsed.is_supplier = 0;
  } else if (parsed.plus_one_of === null) {
    nextIsPlusOne = 0;
    nextPlusOneOf = null;
  }

  // Optional household reassignment. `household_id` may be: omitted (no change),
  // a number (move to that household), or paired with `new_household_label` to
  // spawn a new household for this guest. The resulting household's group_tag
  // overrides whatever the client sent for the guest — household is the source
  // of truth so the chip in the header always matches every member.
  let nextHouseholdId = existing.household_id;
  let inheritedGroupTag: GuestGroupTag | null = null;
  if (typeof body.household_id === "number" && Number.isFinite(body.household_id)) {
    const target = getHouseholdById(body.household_id, couple.id);
    if (!target) throw new HttpError(400, "household_id not found in this couple");
    nextHouseholdId = target.id;
    inheritedGroupTag = isGuestGroupTag(target.group_tag) ? target.group_tag : "other";
  } else if (
    body.household_id === null &&
    typeof body.new_household_label === "string" &&
    body.new_household_label.trim()
  ) {
    const created = createHousehold({
      couple_id: couple.id,
      label: body.new_household_label.trim(),
      group_tag: parsed.group_tag,
      rsvp_offers_accommodation: body.new_household_offers_accommodation === true,
    });
    nextHouseholdId = created.id;
    inheritedGroupTag = parsed.group_tag;
  } else if (nextHouseholdId !== null) {
    // No reassignment requested — keep the guest's group_tag aligned with the
    // current household's tag (the household chip is canonical, even if the
    // legacy drawer happened to ship a different per-guest value).
    const current = getHouseholdById(nextHouseholdId, couple.id);
    if (current)
      inheritedGroupTag = isGuestGroupTag(current.group_tag) ? current.group_tag : "other";
  }
  // Partner-role rows (bride / groom) are exempt — their split her_family /
  // his_family tags drive the dashboard pie's two-clans cut and stay fixed
  // even when the host household carries a single group chip.
  if (inheritedGroupTag !== null && existing.partner_role === null) {
    parsed.group_tag = inheritedGroupTag;
  }

  // Supplier flag takes precedence over the household picker: a supplier is
  // auto-routed to the couple's supplier household; clearing the flag moves a
  // guest back out of it so the supplier household stays pure.
  if (parsed.is_supplier) {
    const sh = getOrCreateSupplierHousehold(couple.id, couple.country ?? "HU");
    nextHouseholdId = sh.id;
    if (existing.partner_role === null) {
      parsed.group_tag = isGuestGroupTag(sh.group_tag) ? sh.group_tag : "other";
    }
  } else if (nextHouseholdId !== null) {
    const cur = getHouseholdById(nextHouseholdId, couple.id);
    if (cur?.is_supplier_household) nextHouseholdId = null;
  }

  // A "+1" always lives in its host's household — override whatever the picker
  // / supplier logic above resolved.
  if (plusOneHost) {
    nextHouseholdId = plusOneHost.household_id;
    if (existing.partner_role === null) {
      parsed.group_tag = isGuestGroupTag(plusOneHost.group_tag) ? plusOneHost.group_tag : "other";
    }
  }

  // Stamp the first real answer the couple records (preserve the original on
  // later edits; clear when set back to pending). The public RSVP path stamps
  // separately via applyMemberCheckin.
  const nextRespondedAt =
    parsed.rsvp_status === "pending" ? null : (existing.rsvp_responded_at ?? ts);

  // Tri-state `invited` + `delivered`: omitted = leave as-is; true = stamp;
  // false = clear. The 3-state chip on /app/guests sends explicit pairs that
  // encode the target state: not-invited (invited:false, delivered:false),
  // invited (invited:true, delivered:false), delivered (delivered:true, which
  // also forces invited=true since delivered implies invited).
  let nextInvitedAt = existing.invited_at;
  if (body.invited === true) nextInvitedAt = ts;
  else if (body.invited === false) nextInvitedAt = null;

  let nextDeliveredAt = existing.invitation_delivered_at;
  if (body.delivered === true) {
    nextDeliveredAt = ts;
    // delivered implies invited — backfill if the client somehow omitted it.
    if (nextInvitedAt === null) nextInvitedAt = ts;
  } else if (body.delivered === false) {
    nextDeliveredAt = null;
  }
  // Clearing `invited` always clears `delivered` (you can't deliver to
  // someone you haven't invited) and also resets the open-tracking stamp
  // so the eye indicator doesn't persist on a guest whose invite was revoked.
  let nextOpenedAt = existing.invitation_opened_at;
  if (nextInvitedAt === null) {
    nextDeliveredAt = null;
    nextOpenedAt = null;
  }

  // Per-channel invite tracking (online link vs physical card). These mirror
  // the legacy invited/delivered flags but record WHICH channel was used so the
  // composer can show none/online/physical/both. Stamping a channel keeps the
  // legacy chips in sync: online implies invited; physical implies delivered
  // (and therefore invited).
  let nextOnlineAt = existing.invited_online_at;
  if (body.invited_online === true) {
    nextOnlineAt = ts;
    if (nextInvitedAt === null) nextInvitedAt = ts;
  } else if (body.invited_online === false) {
    nextOnlineAt = null;
  }
  let nextPhysicalAt = existing.invited_physical_at;
  if (body.invited_physical === true) {
    nextPhysicalAt = ts;
    if (nextDeliveredAt === null) nextDeliveredAt = ts;
    if (nextInvitedAt === null) nextInvitedAt = ts;
  } else if (body.invited_physical === false) {
    nextPhysicalAt = null;
  }

  // The move and the empty-household cleanup are one atomic step: if this guest
  // vacated its previous household and left it with no members, that household
  // is deleted in the same transaction so the guest list, the household picker,
  // and the check-in code space never show a 0-member orphan. Deletion is
  // FK-safe (see domain/household_cleanup.ts).
  const previousHouseholdId = existing.household_id;
  const householdChanged = previousHouseholdId !== nextHouseholdId;
  db.transaction(() => {
    db.prepare(
      `UPDATE guests SET
        full_name = ?, email = ?, phone = ?, group_tag = ?, kind = ?, is_supplier = ?,
        is_plus_one = ?, plus_one_of = ?, rsvp_status = ?,
        meal_choice = ?, dietary = ?, plus_one_name = ?, plus_one_meal = ?,
        accommodation_needed = ?, song_request = ?, notes = ?, rsvp_responded_at = ?, household_id = ?,
        invited_at = ?, invitation_delivered_at = ?, invitation_opened_at = ?,
        invited_online_at = ?, invited_physical_at = ?, updated_at = ?
       WHERE id = ? AND couple_id = ?`,
    ).run(
      parsed.full_name,
      parsed.email,
      parsed.phone,
      parsed.group_tag,
      parsed.kind,
      parsed.is_supplier,
      nextIsPlusOne,
      nextPlusOneOf,
      parsed.rsvp_status,
      parsed.meal_choice,
      parsed.dietary,
      parsed.plus_one_name,
      parsed.plus_one_meal,
      parsed.accommodation_needed,
      parsed.song_request,
      parsed.notes,
      nextRespondedAt,
      nextHouseholdId,
      nextInvitedAt,
      nextDeliveredAt,
      nextOpenedAt,
      nextOnlineAt,
      nextPhysicalAt,
      ts,
      id,
      couple.id,
    );
    if (householdChanged) purgeHouseholdIfEmpty(couple.id, previousHouseholdId);
  })();

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "guest.update",
    target_kind: "guest",
    target_id: id,
    before: { full_name: existing.full_name, household_id: existing.household_id },
    after: { full_name: parsed.full_name, household_id: nextHouseholdId },
  });

  // A filled-in "+1" becomes a real guest in the same household; clear the
  // carrier so re-saving doesn't duplicate it. Skipped when this guest is
  // itself a +1.
  if (!nextIsPlusOne && parsed.plus_one_name) {
    materializePlusOne(
      couple.id,
      { id, household_id: nextHouseholdId, group_tag: parsed.group_tag },
      parsed.plus_one_name,
      parsed.plus_one_meal,
      userId,
    );
    db.prepare("UPDATE guests SET plus_one_name = NULL, plus_one_meal = NULL WHERE id = ?").run(id);
  }

  // Cascade invite state to materialized +1s: when a host's invited/delivered
  // flags change, its plus-ones inherit the same state (single check = invited,
  // double check = delivered). Only fires when the request actually touched the
  // invite flags, so a plain name/meal edit never disturbs a +1's own state.
  // Runs after materializePlusOne so a +1 added in the same save inherits too.
  const inviteFlagsTouched = body.invited !== undefined || body.delivered !== undefined;
  if (inviteFlagsTouched && !nextIsPlusOne) {
    db.prepare(
      `UPDATE guests SET invited_at = ?, invitation_delivered_at = ?, invitation_opened_at = ?, updated_at = ?
         WHERE plus_one_of = ? AND couple_id = ?`,
    ).run(nextInvitedAt, nextDeliveredAt, nextOpenedAt, ts, id, couple.id);
  }

  const row = getGuestByIdScoped(id, couple.id) as GuestRow;
  return json({ guest: toGuest(row) });
}

function handleDelete(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");
  const existing = getGuestByIdScoped(id, couple.id);
  if (!existing) throw new HttpError(404, "Guest not found");

  // Cascade-delete any materialized +1s along with their host. A +1 only exists
  // because its host brought them, so removing the host removes them too. We
  // must delete the +1s FIRST: `guests.plus_one_of` is a self-FK with no
  // ON DELETE action (db.ts:126, added via addColumnIfMissing so its FK can't be
  // ALTERed without a full table rebuild), so deleting the host while +1s still
  // point at it throws SQLITE_CONSTRAINT → 500. One transaction so the cascade
  // is indivisible.
  const plusOnes = db
    .prepare("SELECT id, full_name FROM guests WHERE plus_one_of = ? AND couple_id = ?")
    .all(id, couple.id) as { id: number; full_name: string }[];
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM guests WHERE plus_one_of = ? AND couple_id = ?").run(id, couple.id);
    db.prepare("DELETE FROM guests WHERE id = ? AND couple_id = ?").run(id, couple.id);
  });
  tx();

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "guest.delete",
    target_kind: "guest",
    target_id: id,
    before: { full_name: existing.full_name },
  });
  for (const p of plusOnes) {
    addAuditLog({
      actor_user_id: userId,
      couple_id: couple.id,
      action: "guest.delete",
      target_kind: "guest",
      target_id: p.id,
      before: { full_name: p.full_name, plus_one_of: id },
    });
  }
  return json({ ok: true });
}

const BULK_MAX = 200;

interface BulkBody {
  guests?: unknown;
}

/** Paste-and-go: create up to BULK_MAX guests in a single round-trip. Each
 *  row goes through the same parseUpsert + auto-household path as the single
 *  POST. The whole batch is wrapped in one transaction so an invalid row
 *  rolls back the entire request — paste-flow UX never wants a half-inserted
 *  list with no obvious place to fix the bad row. */
async function handleBulkCreate(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const body = await readJson<BulkBody>(ctx.req);
  if (!Array.isArray(body.guests)) throw new HttpError(400, "guests array required");
  if (body.guests.length === 0) throw new HttpError(400, "guests array is empty");
  if (body.guests.length > BULK_MAX) {
    throw new HttpError(400, `bulk limit is ${BULK_MAX} guests per request`);
  }

  // Pre-parse every row OUTSIDE the transaction so an early bad row throws
  // before any DB work. Errors include the 1-based row index so the UI can
  // highlight the offending line in the paste field.
  const parsed: Array<{ parsed: ParsedGuest; body: UpsertBody }> = [];
  for (let i = 0; i < body.guests.length; i++) {
    const row = body.guests[i];
    if (!row || typeof row !== "object") {
      throw new HttpError(400, `row ${i + 1}: must be an object`);
    }
    try {
      parsed.push({ parsed: parseUpsert(row as UpsertBody), body: row as UpsertBody });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new HttpError(400, `row ${i + 1}: ${msg}`);
    }
  }

  const createdIds = db.transaction((): number[] => {
    const ts = now();
    const ids: number[] = [];
    const insert = db.prepare(
      `INSERT INTO guests
        (couple_id, full_name, email, phone, group_tag, invite_code, kind, rsvp_status,
         meal_choice, dietary, plus_one_name, plus_one_meal, accommodation_needed,
         song_request, notes, rsvp_responded_at, invited_at, invitation_delivered_at,
         created_at, updated_at, household_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?)`,
    );
    for (const { parsed: p, body: b } of parsed) {
      const household = resolveHouseholdForCreate(b, couple.id, p.full_name, p.group_tag);
      p.group_tag = household.group_tag;
      const result = insert.run(
        couple.id,
        p.full_name,
        p.email,
        p.phone,
        p.group_tag,
        uniqueInviteCode(),
        p.kind,
        p.rsvp_status,
        p.meal_choice,
        p.dietary,
        p.plus_one_name,
        p.plus_one_meal,
        p.accommodation_needed,
        p.song_request,
        p.notes,
        ts,
        ts,
        household.id,
      );
      ids.push(Number(result.lastInsertRowid));
    }
    // Single bundled audit entry per request — saves the audit table from
    // ballooning on a paste of 200 names while still giving the activity log
    // something to point at.
    addAuditLog({
      actor_user_id: userId,
      couple_id: couple.id,
      action: "guest.bulk_create",
      target_kind: "guest",
      target_id: ids[0] ?? 0,
      after: { count: ids.length },
    });
    return ids;
  })();

  const guests = createdIds.map((id) => toGuest(getGuestByIdScoped(id, couple.id) as GuestRow));
  return json({ guests }, { status: 201 });
}

interface ImportBody {
  csv?: unknown;
}

const CSV_FIELDS = [
  "full_name",
  "email",
  "phone",
  "group_tag",
  "household",
  "plus_one_name",
  "dietary",
  "notes",
];

async function handleImportCsv(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const body = await readJson<ImportBody>(ctx.req);
  if (typeof body.csv !== "string") throw new HttpError(400, "csv string required");
  if (body.csv.length > 1_000_000) throw new HttpError(400, "CSV too large (max 1MB)");

  const rows = parseCsv(body.csv);
  if (rows.length < 2) throw new HttpError(400, "CSV needs a header row + at least one data row");
  const headerRow = rows[0]!;
  const idx = indexHeaders(headerRow, CSV_FIELDS);
  if (!("full_name" in idx)) {
    throw new HttpError(400, "CSV must have a 'full_name' column");
  }

  const ts = now();
  const insert = db.prepare(
    `INSERT INTO guests
      (couple_id, full_name, email, phone, group_tag, invite_code, rsvp_status,
       meal_choice, dietary, plus_one_name, plus_one_meal, accommodation_needed,
       song_request, notes, rsvp_responded_at, created_at, updated_at, household_id)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?, NULL, 0, NULL, ?, NULL, ?, ?, ?)`,
  );

  const created: Guest[] = [];
  const errors: { row: number; reason: string }[] = [];
  // Wrap in a transaction so a single bad row doesn't leave a partial import.
  // Same-named `household` values get folded into the same household so an
  // import can express "Anna + Mark + Lilla all RSVP together" with one column.
  const tx = db.transaction(() => {
    // Track each household's resolved group_tag so siblings within the same
    // household always inherit a single value — the first row of that
    // household wins, later rows for the same label adopt it. Keeps the
    // household.group_tag === every member.group_tag invariant intact.
    const householdByLabel = new Map<string, { id: number; group_tag: GuestGroupTag }>();
    const ensureHousehold = (
      label: string,
      group: GuestGroupTag,
    ): { id: number; group_tag: GuestGroupTag } => {
      const cached = householdByLabel.get(label);
      if (cached) return cached;
      const created = createHousehold({ couple_id: couple.id, label, group_tag: group });
      const entry = { id: created.id, group_tag: group };
      householdByLabel.set(label, entry);
      return entry;
    };

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]!;
      const name = r[idx.full_name!]?.trim() ?? "";
      if (!name) {
        errors.push({ row: i + 1, reason: "missing full_name" });
        continue;
      }
      const groupRaw = idx.group_tag !== undefined ? (r[idx.group_tag]?.trim() ?? "") : "";
      const requestedGroup: GuestGroupTag = isGuestGroupTag(groupRaw) ? groupRaw : "other";
      const code = uniqueInviteCode();
      const householdLabel = idx.household !== undefined ? (r[idx.household]?.trim() ?? "") : "";
      const household = ensureHousehold(householdLabel || name, requestedGroup);
      const group = household.group_tag; // household wins
      const result = insert.run(
        couple.id,
        name,
        idx.email !== undefined ? r[idx.email]?.trim() || null : null,
        idx.phone !== undefined ? r[idx.phone]?.trim() || null : null,
        group,
        code,
        idx.dietary !== undefined ? r[idx.dietary]?.trim() || null : null,
        idx.plus_one_name !== undefined ? r[idx.plus_one_name]?.trim() || null : null,
        idx.notes !== undefined ? r[idx.notes]?.trim() || null : null,
        ts,
        ts,
        household.id,
      );
      const guestId = Number(result.lastInsertRowid);
      const row = getGuestByIdScoped(guestId, couple.id);
      if (row) created.push(toGuest(row));
    }
  });
  tx();

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "guest.csv_import",
    target_kind: "couple",
    target_id: couple.id,
    after: { count: created.length, errors: errors.length },
  });

  return json({ created_count: created.length, errors }, { status: 201 });
}

function csvField(v: string | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

interface CsvGuestRow extends GuestRow {
  household_label: string | null;
}

function handleExportCsv(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  // Pull rows unsorted and re-order in JS with a Hungarian locale comparator.
  // SQLite's NOCASE collation handles ASCII case only — it shuffles "Ákos"
  // ahead of "Bence" and folds "Csikász" / "Csikasz" inconsistently. The HU
  // collator gets the digraphs (Cs / Sz / Zs) and accented letters right.
  const rowsRaw = db
    .prepare(
      `SELECT g.*, h.label AS household_label
         FROM guests g
         LEFT JOIN households h ON h.id = g.household_id
         WHERE g.couple_id = ?`,
    )
    .all(couple.id) as CsvGuestRow[];
  const rows = [...rowsRaw].sort((a, b) =>
    a.full_name.localeCompare(b.full_name, "hu", { sensitivity: "base" }),
  );

  const headers = [
    "full_name",
    "email",
    "phone",
    "group_tag",
    "kind",
    "household",
    "rsvp_status",
    "meal_choice",
    "dietary",
    "plus_one_name",
    "plus_one_meal",
    "accommodation_needed",
    "song_request",
    "notes",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        csvField(r.full_name),
        csvField(r.email),
        csvField(r.phone),
        csvField(r.group_tag),
        csvField(r.kind),
        csvField(r.household_label),
        csvField(r.rsvp_status),
        csvField(r.meal_choice),
        csvField(r.dietary),
        csvField(r.plus_one_name),
        csvField(r.plus_one_meal),
        r.accommodation_needed ? "1" : "0",
        csvField(r.song_request),
        csvField(r.notes),
      ].join(","),
    );
  }
  // Prepend a UTF-8 BOM so Excel on Windows opens the file as UTF-8 by
  // default — without it, Hungarian accented characters render as mojibake.
  const csv = `﻿${lines.join("\r\n")}\r\n`;
  const body = new TextEncoder().encode(csv);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `weddly-guests-${stamp}.csv`;

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "guest.csv_export",
    target_kind: "couple",
    target_id: couple.id,
    after: { count: rows.length },
  });
  recordExport({
    coupleId: couple.id,
    userId,
    kind: "guest_csv",
    format: null,
    filename,
    contentType: "text/csv; charset=utf-8",
    body,
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Day-of catering aggregate. Counts only guests whose `rsvp_status` is
 *  `yes` or `maybe` — `no` / `pending` are intentionally excluded so the
 *  caterer's headcount matches who's actually expected at the table.
 *
 *  Allergies are a heuristic scan of the free-text `dietary` field. We
 *  intentionally undercount in favour of false-negatives (e.g. "Gluten-free"
 *  is the keyword catch, not "GF") because the caterer reads the raw notes
 *  too; the buckets are a quick-look summary, not the source of truth. */
function handleDietarySummary(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  // Scope to attending guests. Pull only the two columns we need.
  const rows = db
    .prepare(
      `SELECT meal_choice, dietary FROM guests
         WHERE couple_id = ? AND rsvp_status IN ('yes','maybe')`,
    )
    .all(couple.id) as { meal_choice: string | null; dietary: string | null }[];

  const summary: DietarySummary = {
    meal: { meat: 0, fish: 0, vegetarian: 0, vegan: 0, child: 0, none: 0, unspecified: 0 },
    allergies: {
      gluten: 0,
      lactose: 0,
      milk_protein: 0,
      nut: 0,
      egg: 0,
      fish_shellfish: 0,
      other_text_count: 0,
    },
    counted_guests: rows.length,
  };

  // Case-insensitive substring tests. Hungarian keywords first (most common
  // in this market), English fallbacks listed in the same regex. Milk protein
  // is detected before lactose so the "tejfehérje" token (or any free-text
  // "tejfehérje-allergia") gets attributed to the right bucket — the lactose
  // regex deliberately does NOT match the bare "tej" prefix to avoid double-
  // counting milk-protein guests as lactose-intolerant.
  const RE_GLUTEN = /glut[eé]n|gluten/i;
  const RE_MILK_PROTEIN = /tejfehérje|tejfeherje|milk[- ]?protein|casein|kazein/i;
  const RE_LACTOSE = /laktóz|laktoz|lactose|dairy/i;
  const RE_NUT = /mogyoró|mogyoro|mandula|nut|peanut|földimogyoró|földimogyoro/i;
  const RE_EGG = /tojás|tojas|\begg\b|egg[- ]?allerg/i;
  const RE_FISH_SHELLFISH =
    /hal-tengeri|hal[- ]?allerg|tengeri[- ]?herkenty|shellfish|seafood|crustacean/i;

  for (const row of rows) {
    // Meal bucket — defaults to "unspecified" when null or unrecognised.
    const meal = row.meal_choice;
    if (meal === "meat") summary.meal.meat += 1;
    else if (meal === "fish") summary.meal.fish += 1;
    else if (meal === "vegetarian") summary.meal.vegetarian += 1;
    else if (meal === "vegan") summary.meal.vegan += 1;
    else if (meal === "child") summary.meal.child += 1;
    else if (meal === "none") summary.meal.none += 1;
    else summary.meal.unspecified += 1;

    // Allergy bucket — keyword scan over `dietary` text. Run milk_protein
    // before lactose; `matchedKeyword` flips once so a multi-allergen note
    // doesn't also count as "other_text".
    const text = (row.dietary ?? "").trim();
    if (!text) continue;
    let matchedKeyword = false;
    if (RE_GLUTEN.test(text)) {
      summary.allergies.gluten += 1;
      matchedKeyword = true;
    }
    if (RE_MILK_PROTEIN.test(text)) {
      summary.allergies.milk_protein += 1;
      matchedKeyword = true;
    }
    if (RE_LACTOSE.test(text)) {
      summary.allergies.lactose += 1;
      matchedKeyword = true;
    }
    if (RE_NUT.test(text)) {
      summary.allergies.nut += 1;
      matchedKeyword = true;
    }
    if (RE_EGG.test(text)) {
      summary.allergies.egg += 1;
      matchedKeyword = true;
    }
    if (RE_FISH_SHELLFISH.test(text)) {
      summary.allergies.fish_shellfish += 1;
      matchedKeyword = true;
    }
    if (!matchedKeyword) summary.allergies.other_text_count += 1;
  }

  return json(summary);
}

export function registerGuestRoutes(router: Router) {
  router.get("/api/guests", handleList, true);
  // Aggregate route comes BEFORE the :id-parameterised routes so the
  // literal path "dietary-summary" doesn't get captured by /api/guests/:id.
  router.get("/api/guests/dietary-summary", handleDietarySummary, true);
  router.post("/api/guests", handleCreate, true);
  // Bulk endpoint MUST be registered before the :id-parameterised routes so
  // the literal "bulk" segment doesn't get captured as an id.
  router.post("/api/guests/bulk", handleBulkCreate, true);
  router.patch("/api/guests/:id", handleUpdate, true);
  router.delete("/api/guests/:id", handleDelete, true);
  router.post("/api/guests/import", handleImportCsv, true);
  router.get("/api/guests/csv", handleExportCsv, true);
}
