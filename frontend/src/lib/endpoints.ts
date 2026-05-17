// One typed wrapper per HTTP call. Components import these — never `fetch` directly.

import type {
  Accommodation,
  AdminCoupleView,
  AdminSidebarBadges,
  AdminUserView,
  AuthSession,
  BudgetCategory,
  BudgetGoal,
  BudgetLine,
  BudgetSnapshot,
  CeremonyKind,
  CheckinSubmitBody,
  Couple,
  CoupleActivityEntry,
  CoupleInvite,
  CouplePartnerView,
  CouplePauseRequest,
  CoupleStatus,
  Currency,
  DataExportSummary,
  DietarySummary,
  FlightEstimate,
  GuestCountGoal,
  Guest,
  GuestGroupTag,
  Household,
  MoodboardPin,
  PlaceSuggestion,
  PublicCheckinView,
  PublicRsvpView,
  SeatAssignment,
  SeatingConflict,
  SeatingTable,
  TableShape,
  Transfer,
  UpsertAccommodationInput,
  UpsertTransferInput,
  User,
  WeddingDateGoal,
  WeddingStyleTag,
} from "@shared/types";
import type { GuestPortalView } from "@shared/guest_portal";
import type { ScheduleEvent, UpsertScheduleEventInput } from "@shared/schedule";
import type {
  CommunitySupplierAdminView,
  CommunitySupplierReportReason,
  SubmitCommunitySupplierInput,
} from "@shared/community_suppliers";
import type {
  CoupleSupplier,
  CreateCoupleSupplierInput,
  UpdateCoupleSupplierInput,
} from "@shared/couple_suppliers";
import type { CoupleSupplierCost, UpsertCoupleSupplierCostInput } from "@shared/supplier_costs";
import type { FeedbackEntry, FeedbackStatus } from "@shared/feedback";
import type {
  DecideVendorWaitlistInput,
  SubmitVendorWaitlistInput,
  VendorWaitlistAdminView,
  VendorWaitlistEntry,
} from "@shared/vendor_waitlist";
import type { CouplePick } from "@shared/picks";
import type {
  AdminDirectoryFilters,
  DirectorySupplier,
  SupplierCategory,
  SupplierDirectoryAdminRow,
  SupplierEventInput,
} from "@shared/suppliers";
import type {
  AdminSupplierCategory,
  AdminSupplierGroup,
  CreateSupplierCategoryInput,
  CreateSupplierGroupInput,
  SupplierTaxonomy,
  UpdateSupplierCategoryInput,
  UpdateSupplierGroupInput,
} from "@shared/supplier_taxonomy";
import { apiFetch, getToken } from "./api";

export const authApi = {
  register: (body: { email: string; password: string; full_name: string }) =>
    apiFetch<AuthSession>("POST", "/api/auth/register", body),
  login: (body: { email: string; password: string }) =>
    apiFetch<AuthSession>("POST", "/api/auth/login", body),
  logout: () => apiFetch<{ ok: true }>("POST", "/api/auth/logout"),
  me: () => apiFetch<{ user: User }>("GET", "/api/auth/me"),
  forgot: (email: string) => apiFetch<{ ok: true }>("POST", "/api/auth/forgot", { email }),
  reset: (token: string, password: string) =>
    apiFetch<{ ok: true }>("POST", "/api/auth/reset", { token, password }),
  changePassword: (body: { current_password: string; new_password: string }) =>
    apiFetch<AuthSession>("POST", "/api/auth/change-password", body),
  changeEmailRequest: (body: { new_email: string; current_password: string }) =>
    apiFetch<{ ok: true }>("POST", "/api/auth/change-email-request", body),
  confirmEmailChange: (token: string) =>
    apiFetch<{ ok: true; email: string }>(
      "POST",
      `/api/auth/change-email/${encodeURIComponent(token)}`,
      {},
    ),
  requestVerify: () =>
    apiFetch<{ ok: true; already_verified?: boolean }>("POST", "/api/auth/verify/request", {}),
  verifyEmail: (token: string) =>
    apiFetch<{ ok: true }>("POST", `/api/auth/verify/${encodeURIComponent(token)}`, {}),
};

export interface OnboardInput {
  bride_name: string;
  groom_name: string;
  /** Structured goal — preferred. If absent, the legacy scalars below are honoured. */
  wedding_date_goal?: WeddingDateGoal;
  guest_count_goal?: GuestCountGoal;
  budget_goal?: BudgetGoal;
  /** Display currency. Defaults to HUF on the backend when omitted. */
  currency?: Currency;
  /** Legacy scalars — kept for one or two clients still on the old shape. */
  wedding_date?: string | null;
  target_guest_count?: number | null;
  budget_ceiling_huf?: number | null;
  location_lat?: number | null;
  location_lng?: number | null;
  location_radius_km?: number | null;
  style_tags: WeddingStyleTag[];
}

/** One workspace summary as returned by `/api/users/me/couples`. Shared
 *  between the header switcher and the Profile workspaces panel. */
export interface CoupleMembershipView {
  couple_id: number;
  display_name: string;
  bride_name: string;
  groom_name: string;
  wedding_date: string | null;
  status: CoupleStatus;
  role: "owner" | "partner";
  joined_at: number;
}

export const coupleApi = {
  current: () => apiFetch<{ couple: Couple | null }>("GET", "/api/couples/current"),
  /** Every workspace this user is a member of (Alpha / Bravo / Charlie).
   *  `current_couple_id` matches whichever is active right now — same value
   *  the next `current()` call would resolve to. */
  listMine: () =>
    apiFetch<{ current_couple_id: number | null; couples: CoupleMembershipView[] }>(
      "GET",
      "/api/users/me/couples",
    ),
  /** Flip `users.couple_id` to a different workspace the caller is a
   *  member of. Idempotent. The frontend follows up with a hard reload
   *  since every page reads couple-scoped data on mount and rebuilding
   *  the in-memory state piecemeal is fragile. */
  switchActive: (coupleId: number) =>
    apiFetch<{ couple: Couple }>("POST", "/api/users/me/active-couple", {
      couple_id: coupleId,
    }),
  /** Create Bravo / Charlie for an already-onboarded user. Bride/groom are
   *  inherited from the caller's current workspace — every event for one
   *  wedding shares the same couple — so the caller only specifies an
   *  event name (e.g. "Polgári szertartás", "Családi vacsora") and an
   *  optional date. `seed_*` lets the caller copy a subset of the current
   *  workspace's guests + their households into the new one; everything
   *  else (budget lines, seating, schedule) starts fresh. */
  createAdditional: (body: {
    event_name: string;
    wedding_date_goal: WeddingDateGoal;
    seed_from_couple_id?: number | null;
    seed_guest_ids?: number[];
  }) =>
    apiFetch<{
      couple: Couple;
      seeded: { households_copied: number; guests_copied: number };
    }>("POST", "/api/couples", body),
  /** Destroy a SECONDARY workspace (Bravo / Charlie). 403 when the user
   *  isn't the owner, 409 when the workspace is the active one or their
   *  primary (Alpha). Paired with a 3-click arm pattern in the Profile
   *  workspaces panel so a stray click can't nuke a workspace. */
  deleteWorkspace: (coupleId: number) =>
    apiFetch<{ ok: true }>("DELETE", `/api/couples/${coupleId}`),
  partner: () => apiFetch<{ partner: CouplePartnerView | null }>("GET", "/api/couples/partner"),
  /** Last 14 days of partner-visible activity (saves, uploads, deletes,
   *  RSVPs, exports). Used by the Profile "activity" panel. */
  activity: () => apiFetch<{ entries: CoupleActivityEntry[] }>("GET", "/api/couples/activity"),
  onboard: (body: OnboardInput) =>
    apiFetch<{ couple: Couple }>("POST", "/api/couples/onboard", body),
  /** Partial update — supports `wedding_date_goal`, `guest_count_goal`,
   *  `budget_goal`, `ceremony_kind`, the honeymoon trip header fields
   *  (destination + start/end dates), partner names, the cost-planning
   *  scenario `planning_count`, and the frozen-category set. */
  update: (body: {
    bride_name?: string;
    groom_name?: string;
    display_name?: string;
    wedding_date_goal?: WeddingDateGoal;
    guest_count_goal?: GuestCountGoal;
    budget_goal?: BudgetGoal;
    ceremony_kind?: CeremonyKind | null;
    honeymoon_destination?: string | null;
    honeymoon_start_date?: string | null;
    honeymoon_end_date?: string | null;
    planning_count?: number | null;
    frozen_categories?: BudgetCategory[];
    currency?: Currency;
    rsvp_offers_accommodation?: boolean;
    rsvp_collects_meal?: boolean;
  }) => apiFetch<{ couple: Couple }>("PATCH", "/api/couples/current", body),
  /** Archive the workspace — flips status to `archived` and triggers a
   *  final-bundle export (seating PDF + guests CSV + JSON snapshot). */
  archive: () => apiFetch<{ couple: Couple }>("POST", "/api/couples/current/archive", {}),
  /** Fan-out a "wedding date changed" notification to every guest with an
   *  email address on file. Returns the headcount the server attempted. */
  notifyDateChange: () =>
    apiFetch<{ notified_count: number; skipped_count: number }>(
      "POST",
      "/api/couples/current/notify-date-change",
      {},
    ),
  /** Dismiss the dashboard "date changed" banner without sending notifications.
   *  Clears `previous_wedding_date` server-side so the banner disappears on the
   *  next refresh. No emails go out. */
  dismissDateChange: () =>
    apiFetch<{ ok: true }>("POST", "/api/couples/current/dismiss-date-change", {}),
  updateSlug: (slug: string) =>
    apiFetch<{ couple: Couple }>("PATCH", "/api/couples/slug", { slug }),
  createInvite: (body: { invited_email?: string }) =>
    apiFetch<{ invite: CoupleInvite }>("POST", "/api/couples/invites", body),
  /** Read the couple's pending invite, if any. Used by the Dashboard to
   *  decide whether to render its "invite your partner" panel and by the
   *  Profile partner card to surface a typo'd email. */
  currentInvite: () =>
    apiFetch<{ invite: CoupleInvite | null }>("GET", "/api/couples/invites/current"),
  /** Revoke whichever invite this couple has open (if any). Idempotent —
   *  returns `cancelled: false` when there was nothing to cancel. */
  cancelInvite: () =>
    apiFetch<{ ok: true; cancelled: boolean }>("POST", "/api/couples/invites/cancel"),
  getInvite: (token: string) =>
    apiFetch<{ invite: CoupleInvite; couple_display_name: string | null }>(
      "GET",
      `/api/invites/${encodeURIComponent(token)}`,
    ),
  acceptInvite: (token: string) =>
    apiFetch<{ couple: Couple }>("POST", `/api/invites/${encodeURIComponent(token)}/accept`, {}),
  /** Accept-and-merge: purges the current user's solo workspace, then links
   *  them as partner B on the inviting couple. Server requires the literal
   *  string `"MERGE"` as the confirm token. */
  acceptInviteMerge: (token: string) =>
    apiFetch<{ couple: Couple }>("POST", `/api/invites/${encodeURIComponent(token)}/accept-merge`, {
      confirm: "MERGE",
    }),
  /** Lists pending invites addressed to the current user's email — drives
   *  the dashboard "your partner already started a workspace" banner. */
  incomingInvites: () =>
    apiFetch<{
      invites: Array<{
        token: string;
        couple_display_name: string;
        inviter_name: string;
        inviter_email: string;
        expires_at: number;
      }>;
    }>("GET", "/api/invites/incoming"),
};

export interface GuestUpsert extends Partial<Guest> {
  /** Optional new household — paired with `household_id: null`, creates a
   *  household with this label and puts the guest in it. */
  new_household_label?: string;
  /** Tri-state flag for the "invited" checkbox: `true` stamps invited_at to
   *  now, `false` clears it, omitted leaves the field as-is. */
  invited?: boolean;
  /** Same shape as `invited`, but for the "invitation handed over" stamp.
   *  `true` implies invited=true server-side. */
  delivered?: boolean;
}

export const guestApi = {
  list: () => apiFetch<{ guests: Guest[]; total?: number }>("GET", "/api/guests"),
  /** Server-side search + pagination. `total` is only returned when at least
   *  one of `q` / `limit` / `offset` is provided. */
  search: (params: { q?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.limit !== undefined) qs.set("limit", String(params.limit));
    if (params.offset !== undefined) qs.set("offset", String(params.offset));
    const suffix = qs.toString();
    return apiFetch<{ guests: Guest[]; total: number }>(
      "GET",
      suffix ? `/api/guests?${suffix}` : "/api/guests",
    );
  },
  create: (body: GuestUpsert) => apiFetch<{ guest: Guest }>("POST", "/api/guests", body),
  update: (id: number, body: GuestUpsert) =>
    apiFetch<{ guest: Guest }>("PATCH", `/api/guests/${id}`, body),
  remove: (id: number) => apiFetch<{ ok: true }>("DELETE", `/api/guests/${id}`),
  importCsv: (csv: string) =>
    apiFetch<{ created_count: number; errors: { row: number; reason: string }[] }>(
      "POST",
      "/api/guests/import",
      { csv },
    ),
};

/** Day-of catering aggregate. Counts only `rsvp_status in (yes,maybe)`
 *  guests; allergies are a heuristic keyword scan over the free-text
 *  `dietary` field — see `DietarySummary` docs in shared/types.ts. */
export const dietaryApi = {
  summary: () => apiFetch<DietarySummary>("GET", "/api/guests/dietary-summary"),
};

/** Moodboard — proxies a public Pinterest board's RSS feed and returns its
 *  pins. The backend distinguishes private/missing/empty boards so the page
 *  can surface a specific error instead of a blank widget. */
export const moodboardApi = {
  preview: (url: string) =>
    apiFetch<{ pins: MoodboardPin[] }>(
      "GET",
      `/api/moodboard/preview?url=${encodeURIComponent(url)}`,
    ),
};

/** Honeymoon destination autocomplete — proxies OpenStreetMap Nominatim. */
export const placesApi = {
  search: (q: string) =>
    apiFetch<{ places: PlaceSuggestion[] }>("GET", `/api/places/search?q=${encodeURIComponent(q)}`),
};

/** Honeymoon-specific server state. Right now only the Amadeus flight
 *  estimate; destination + dates ride along on /api/couples. The estimate is
 *  server-cached for 12 h, so calling this from a page mount is cheap. */
export const honeymoonApi = {
  flightEstimate: () =>
    apiFetch<{ estimate: FlightEstimate | null }>("GET", "/api/honeymoon/flight-estimate"),
};

/** Day-of run-of-show timeline. Times are minutes from midnight in wedding-
 *  day-local time so a date shift right up to D-1 doesn't rewrite every row. */
export const scheduleApi = {
  list: () => apiFetch<{ events: ScheduleEvent[] }>("GET", "/api/schedule"),
  create: (body: UpsertScheduleEventInput) =>
    apiFetch<{ event: ScheduleEvent }>("POST", "/api/schedule", body),
  /** Partial PATCH with optional optimistic-concurrency guard. Pass `ifMatch`
   *  with the row's last `updated_at` to make the server return 409 if a
   *  concurrent editor has touched the same event in the meantime. */
  update: (
    id: number,
    body: Partial<UpsertScheduleEventInput>,
    opts: { ifMatch?: number | string } = {},
  ) =>
    apiFetch<{ event: ScheduleEvent }>("PATCH", `/api/schedule/${id}`, body, {
      headers: opts.ifMatch !== undefined ? { "If-Match": String(opts.ifMatch) } : undefined,
    }),
  remove: (id: number) => apiFetch<{ ok: true }>("DELETE", `/api/schedule/${id}`),
};

/** Per-user couple membership — today, just leaving a partner-B seat. */
export const userApi = {
  leaveCouple: () => apiFetch<{ ok: true }>("POST", "/api/users/me/leave-couple", {}),
};

export interface PlanningItemCreate {
  kind: "task" | "idea" | "schedule";
  /** Sub-topic the item belongs to. Omit / pass null to keep it "wedding"
   *  by default. Wand items stamped at the planning page's task-template
   *  apply step. */
  topic?: "wedding" | "honeymoon" | null;
  title: string;
  body?: string | null;
  done?: boolean;
  due_date?: string | null;
  scheduled_time?: string | null;
  /** Tasks only — free-text owner. */
  assignee?: string | null;
  /** Tasks only — ISO YYYY-MM-DD start of the Gantt range. */
  start_date?: string | null;
  /** Tasks only — public supplier id from `couple_picks.supplier_id`. */
  supplier_id?: string | null;
  /** Tasks only — SOS / important flag. 0 = none, 1 = "!", 2 = "!!". */
  priority?: 0 | 1 | 2;
  position?: number;
}

export type PlanningItemPatch = Partial<Omit<PlanningItemCreate, "kind">>;

export const planningApi = {
  list: () => apiFetch<{ items: import("@shared/types").PlanningItem[] }>("GET", "/api/planning"),
  create: (body: PlanningItemCreate) =>
    apiFetch<{ item: import("@shared/types").PlanningItem }>("POST", "/api/planning", body),
  update: (id: number, body: PlanningItemPatch) =>
    apiFetch<{ item: import("@shared/types").PlanningItem }>("PATCH", `/api/planning/${id}`, body),
  remove: (id: number) => apiFetch<{ ok: true }>("DELETE", `/api/planning/${id}`),
};

export const householdApi = {
  list: () => apiFetch<{ households: Household[] }>("GET", "/api/households"),
  create: (body: { label: string; notes?: string | null; group_tag?: GuestGroupTag }) =>
    apiFetch<{ household: Household }>("POST", "/api/households", body),
  update: (
    id: number,
    body: {
      label?: string;
      notes?: string | null;
      group_tag?: GuestGroupTag;
      /** Per-household opt-in for the public RSVP "needs accommodation?"
       *  question. Migrated off the couple-level toggle in May 2026. */
      rsvp_offers_accommodation?: boolean;
      /** Per-household opt-out for the public RSVP meal-choice icon row. */
      rsvp_collects_meal?: boolean;
    },
  ) => apiFetch<{ household: Household }>("PATCH", `/api/households/${id}`, body),
  remove: (id: number) => apiFetch<{ ok: true }>("DELETE", `/api/households/${id}`),
  regenerateCode: (id: number) =>
    apiFetch<{ household: Household }>("POST", `/api/households/${id}/regenerate-code`, {}),
};

export const budgetApi = {
  listLines: () => apiFetch<{ lines: BudgetLine[] }>("GET", "/api/budget/lines"),
  createLine: (body: Partial<BudgetLine>) =>
    apiFetch<{ line: BudgetLine }>("POST", "/api/budget/lines", body),
  /** Partial PATCH with optional optimistic-concurrency guard. Pass `ifMatch`
   *  with the row's last `updated_at` to make the server return 409 if a
   *  concurrent editor has touched the same row in the meantime. */
  updateLine: (id: number, body: Partial<BudgetLine>, opts: { ifMatch?: number | string } = {}) =>
    apiFetch<{ line: BudgetLine }>("PATCH", `/api/budget/lines/${id}`, body, {
      headers: opts.ifMatch !== undefined ? { "If-Match": String(opts.ifMatch) } : undefined,
    }),
  removeLine: (id: number) => apiFetch<{ ok: true }>("DELETE", `/api/budget/lines/${id}`),
  listSnapshots: () => apiFetch<{ snapshots: BudgetSnapshot[] }>("GET", "/api/budget/snapshots"),
  createSnapshot: (body: { name: string }) =>
    apiFetch<{ snapshot: BudgetSnapshot }>("POST", "/api/budget/snapshots", body),
  /** Replay a saved snapshot over the live budget. Wipes non-DIY lines,
   *  re-inserts the snapshot's rows, and leaves supplier-mirrored DIY
   *  lines untouched (the supplier card owns those). Bumps the couple's
   *  `updated_at` on commit. */
  restoreSnapshot: (id: number) =>
    apiFetch<{ restored_count: number; snapshot: BudgetSnapshot }>(
      "POST",
      `/api/budget/snapshots/${id}/restore`,
      {},
    ),
  removeSnapshot: (id: number) => apiFetch<{ ok: true }>("DELETE", `/api/budget/snapshots/${id}`),
};

export const rsvpApi = {
  /** New airport-style check-in: couple slug + 4-digit household code. */
  lookup: (couple: string, code: string) =>
    apiFetch<{ rsvp: PublicCheckinView }>(
      "GET",
      `/api/rsvp/lookup?couple=${encodeURIComponent(couple)}&code=${encodeURIComponent(code)}`,
    ),
  /** Submit RSVPs for every member of the household in one shot. The optional
   *  `idempotencyKey` is forwarded as an `Idempotency-Key` header so the server
   *  can dedupe retries from the offline queue (5 min cache window). */
  checkin: (body: CheckinSubmitBody, opts?: { idempotencyKey?: string }) =>
    apiFetch<{ rsvp: PublicCheckinView }>(
      "POST",
      "/api/rsvp/checkin",
      body,
      opts?.idempotencyKey ? { headers: { "Idempotency-Key": opts.idempotencyKey } } : undefined,
    ),
  /** Legacy per-guest invite_code path. Kept so old `/rsvp/<6char>` URLs
   *  printed on older invite cards keep resolving — server now returns the
   *  same household view. */
  legacyGet: (code: string) =>
    apiFetch<{ rsvp: PublicCheckinView }>("GET", `/api/rsvp/${encodeURIComponent(code)}`),
  /** @deprecated — single-guest legacy submit. New UI uses `checkin`. */
  legacySubmit: (code: string, body: Partial<PublicRsvpView>) =>
    apiFetch<{ rsvp: PublicRsvpView }>("POST", `/api/rsvp/${encodeURIComponent(code)}`, body),
};

export const guestPortalApi = {
  /** Public — fetches the post-RSVP "for guests" bundle (date, ceremony,
   *  location, schedule, household members). Returns 403 with
   *  `detail.code === "not_rsvpd"` if no household member has RSVP'd yes
   *  yet; the page maps that into a "please RSVP first" gate. */
  get: (couple: string, code: string) =>
    apiFetch<{ portal: GuestPortalView }>(
      "GET",
      `/api/guest/portal?couple=${encodeURIComponent(couple)}&code=${encodeURIComponent(code)}`,
    ),
};

export interface SeatingPlan {
  tables: SeatingTable[];
  assignments: SeatAssignment[];
  conflicts: SeatingConflict[];
}

export const seatingApi = {
  plan: () => apiFetch<SeatingPlan>("GET", "/api/seating/plan"),
  createTable: (body: {
    label: string;
    shape: TableShape;
    seats: number;
    x_mm: number;
    y_mm: number;
    width_mm?: number;
    length_mm?: number;
    rotation_deg?: number;
    disabled_seats?: number[];
    baby_seats?: number[];
    is_kids_table?: boolean;
  }) => apiFetch<{ table: SeatingTable }>("POST", "/api/seating/tables", body),
  /** Partial PATCH with optional `If-Match` for optimistic concurrency.
   *  Pass the row's `updated_at` (or stringified equivalent) to get a 409
   *  when a second editor has touched the same table since the last load. */
  updateTable: (
    id: number,
    body: Partial<SeatingTable>,
    opts: { ifMatch?: number | string } = {},
  ) =>
    apiFetch<{ table: SeatingTable }>("PATCH", `/api/seating/tables/${id}`, body, {
      headers: opts.ifMatch !== undefined ? { "If-Match": String(opts.ifMatch) } : undefined,
    }),
  removeTable: (id: number) => apiFetch<{ ok: true }>("DELETE", `/api/seating/tables/${id}`),
  assign: (body: { table_id: number; seat_index: number; guest_id: number }) =>
    apiFetch<{ ok: true }>("POST", "/api/seating/assign", body),
  unassign: (guest_id: number) =>
    apiFetch<{ ok: true }>("POST", "/api/seating/unassign", { guest_id }),
  /** Atomic swap of two assigned guests' seats in one server-side
   *  transaction. Replaces the multi-call dance the old UI did. */
  swap: (body: { guest_a_id: number; guest_b_id: number }) =>
    apiFetch<{ ok: true }>("POST", "/api/seating/swap", body),
  createConflict: (body: {
    guest_a_id: number;
    guest_b_id: number;
    kind: "split" | "avoid";
    note?: string;
  }) => apiFetch<{ conflict: SeatingConflict }>("POST", "/api/seating/conflicts", body),
  removeConflict: (id: number) => apiFetch<{ ok: true }>("DELETE", `/api/seating/conflicts/${id}`),
};

/** Logistics: lodgings the couple offers their guests. Drag-and-drop assignment
 *  on /app/logistics flips `guests.accommodation_id` via `assign`. */
export const accommodationApi = {
  list: () => apiFetch<{ accommodations: Accommodation[] }>("GET", "/api/accommodations"),
  create: (body: UpsertAccommodationInput) =>
    apiFetch<{ accommodation: Accommodation }>("POST", "/api/accommodations", body),
  update: (id: number, body: Partial<UpsertAccommodationInput>) =>
    apiFetch<{ accommodation: Accommodation }>("PATCH", `/api/accommodations/${id}`, body),
  remove: (id: number) => apiFetch<{ ok: true }>("DELETE", `/api/accommodations/${id}`),
  /** Assign a guest to an accommodation (or pass null to unassign). */
  assign: (body: { guest_id: number; accommodation_id: number | null }) =>
    apiFetch<{ ok: true }>("POST", "/api/accommodations/assign", body),
};

/** Logistics: transfer trips. v1 is "basic" — flat list, label + optional
 *  direction/time/capacity. */
export const transferApi = {
  list: () => apiFetch<{ transfers: Transfer[] }>("GET", "/api/transfers"),
  create: (body: UpsertTransferInput) =>
    apiFetch<{ transfer: Transfer }>("POST", "/api/transfers", body),
  update: (id: number, body: Partial<UpsertTransferInput>) =>
    apiFetch<{ transfer: Transfer }>("PATCH", `/api/transfers/${id}`, body),
  remove: (id: number) => apiFetch<{ ok: true }>("DELETE", `/api/transfers/${id}`),
  assign: (body: { guest_id: number; transfer_id: number | null }) =>
    apiFetch<{ ok: true }>("POST", "/api/transfers/assign", body),
};

export const pauseApi = {
  status: () =>
    apiFetch<{ couple_status: CoupleStatus; pause_request: CouplePauseRequest | null }>(
      "GET",
      "/api/couples/pause",
    ),
  request: (reason?: string) =>
    apiFetch<{ pause_request: CouplePauseRequest }>("POST", "/api/couples/pause", { reason }),
  cancel: () => apiFetch<{ ok: true }>("POST", "/api/couples/pause/cancel"),
};

export const exportApi = {
  /** GDPR Article 20: returns a JSON blob with everything the couple owns.
   *  Server-side this also snapshots the result into the saved download
   *  archive (see `documentsApi.list`). */
  download: () => apiFetch<Record<string, unknown>>("GET", "/api/couples/export"),
};

/** Saved download archive — every JSON / PDF / CSV the user has downloaded
 *  is stored server-side and listed back on the Profile page. */
export const documentsApi = {
  list: () => apiFetch<{ exports: DataExportSummary[] }>("GET", "/api/exports"),
  remove: (id: number) => apiFetch<{ ok: true }>("DELETE", `/api/exports/${id}`),
};

/** Auth-protected blob download for any saved export. The caller saves the
 *  blob with the server-provided filename. */
export async function fetchSavedExportBlob(id: number): Promise<Blob> {
  const token = getToken();
  const res = await fetch(`/api/exports/${id}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) throw new Error(`Export fetch failed: ${res.status}`);
  return res.blob();
}

/** Trigger the live guest-list CSV export. The server snapshots a copy into
 *  the saved download archive on the way out. */
export async function fetchGuestCsvBlob(): Promise<Blob> {
  const token = getToken();
  const res = await fetch("/api/guests/csv", {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) throw new Error(`CSV fetch failed: ${res.status}`);
  return res.blob();
}

export const supplierApi = {
  list: (category?: SupplierCategory) =>
    apiFetch<{ suppliers: DirectorySupplier[] }>(
      "GET",
      category ? `/api/suppliers?category=${category}` : "/api/suppliers",
    ),
  submitCommunity: (body: SubmitCommunitySupplierInput) =>
    apiFetch<{ supplier: DirectorySupplier }>("POST", "/api/suppliers/community", body),
  /** Best-effort resolver: paste a Google Maps URL, get back any of:
   *  name, address, city, lat/lng, website, phone. Each field may be null. */
  resolveMapsUrl: (url: string) =>
    apiFetch<{
      place: {
        name: string | null;
        address: string | null;
        city: string | null;
        lat: number | null;
        lng: number | null;
        website: string | null;
        phone: string | null;
      };
    }>("POST", "/api/suppliers/resolve-maps-url", { url }),
  vote: (supplierId: string, value: -1 | 0 | 1) =>
    apiFetch<{ supplier_id: string; votes_score: number; user_vote: -1 | 0 | 1 }>(
      "PUT",
      `/api/suppliers/${encodeURIComponent(supplierId)}/vote`,
      { value },
    ),
  /** Report an abusive / fake / spam community listing. `supplierId` is the
   *  numeric part of a community supplier id (i.e. `5` from `"c5"`). The
   *  backend de-duplicates per (supplier, reporter) so calling twice from
   *  the same user is a no-op. Three distinct reporters → auto-hide. */
  reportCommunity: (supplierId: number, reason: CommunitySupplierReportReason, note?: string) =>
    apiFetch<{
      ok: boolean;
      duplicate: boolean;
      auto_hidden: boolean;
      report_count: number;
    }>("POST", `/api/suppliers/community/${supplierId}/report`, {
      reason,
      note: note ?? null,
    }),
  /** Consume the verification token from the email sent to the listing's
   *  contact_email. Flips the supplier from 'pending' to 'active' so it
   *  shows up in the public directory. Public endpoint — no auth. */
  verifyCommunity: (token: string) =>
    apiFetch<{ ok: boolean; already_consumed: boolean }>(
      "POST",
      `/api/suppliers/community/verify/${encodeURIComponent(token)}`,
      {},
    ),
  /** Best-effort visit analytics. Anonymous-tolerant; the backend rate-limits
   *  per IP. Caller passes a batch of events (page-load view + click-throughs)
   *  so we make one POST per page instead of one per row. */
  recordEvents: (events: SupplierEventInput[]) =>
    apiFetch<{ recorded: number }>("POST", "/api/suppliers/events", { events }),
};

export const coupleSupplierApi = {
  list: () => apiFetch<{ suppliers: CoupleSupplier[] }>("GET", "/api/couple-suppliers"),
  create: (body: CreateCoupleSupplierInput) =>
    apiFetch<{ supplier: CoupleSupplier }>("POST", "/api/couple-suppliers", body),
  update: (id: string, body: UpdateCoupleSupplierInput) =>
    apiFetch<{ supplier: CoupleSupplier }>(
      "PATCH",
      `/api/couple-suppliers/${encodeURIComponent(id)}`,
      body,
    ),
  remove: (id: string) =>
    apiFetch<{ ok: true }>("DELETE", `/api/couple-suppliers/${encodeURIComponent(id)}`),
};

export const supplierCostApi = {
  list: () => apiFetch<{ costs: CoupleSupplierCost[] }>("GET", "/api/couples/supplier-costs"),
  upsert: (supplierId: string, body: UpsertCoupleSupplierCostInput) =>
    apiFetch<{ cost: CoupleSupplierCost }>(
      "PUT",
      `/api/couples/supplier-costs/${encodeURIComponent(supplierId)}`,
      body,
    ),
};

/** Per-category "this is our pick" supplier selections. Shared between
 *  partners so partner B on another device sees the same picks — see
 *  backend/src/routes/couple_picks.ts. */
export const picksApi = {
  list: () => apiFetch<{ picks: CouplePick[] }>("GET", "/api/picks"),
  set: (category: string, supplier_id: string) =>
    apiFetch<{ pick: CouplePick }>("PUT", `/api/picks/${encodeURIComponent(category)}`, {
      supplier_id,
    }),
  clear: (category: string) =>
    apiFetch<{ ok: true }>("DELETE", `/api/picks/${encodeURIComponent(category)}`),
};

export const adminUserApi = {
  listUsers: () => apiFetch<{ users: AdminUserView[] }>("GET", "/api/admin/users"),
  listCouples: () => apiFetch<{ couples: AdminCoupleView[] }>("GET", "/api/admin/couples"),
  resendVerify: (id: number) =>
    apiFetch<{ ok: true; already_verified?: boolean }>(
      "POST",
      `/api/admin/users/${id}/resend-verify`,
      {},
    ),
  remove: (id: number) => apiFetch<{ ok: true }>("DELETE", `/api/admin/users/${id}`),
  /** Moderation flag — emails the user with the reason and starts the
   *  7-day auto-purge countdown. Returns the updated admin view (with
   *  `active_flag` populated) so the row re-renders without a refetch. */
  flag: (id: number, reason: string) =>
    apiFetch<{ user: AdminUserView | null }>("POST", `/api/admin/users/${id}/flag`, { reason }),
  /** Clear the user's open flag. The optional `note` records the
   *  resolution in the audit row (e.g. "user replied — concern addressed").
   *  Idempotent: returns `cleared: false` when no flag was open. */
  unflag: (id: number, note?: string) =>
    apiFetch<{ user: AdminUserView | null; cleared: boolean }>(
      "POST",
      `/api/admin/users/${id}/unflag`,
      { note: note ?? "" },
    ),
  /** One-shot bulk re-purge of every couple flagged `status="deleting"`. */
  purgeDeleting: () =>
    apiFetch<{ purged: number }>("POST", "/api/admin/couples/purge-deleting", {}),
  /** Unread-style counts for the admin nav rail. AppShell polls this
   *  every ~30s while the admin is signed in and renders a small red
   *  badge next to each section with count > 0. */
  sidebarBadges: () => apiFetch<AdminSidebarBadges>("GET", "/api/admin/sidebar-badges"),
  /** Instagram-style "I looked at this" ping — stamps `admin_section_seen.seen_at`
   *  for this admin+section so the next badge poll counts only rows authored
   *  AFTER the visit. AppShell fires this on navigation into the matching
   *  /app/admin/{section} path. */
  markSectionSeen: (section: "suppliers" | "users" | "vendor_waitlist" | "feedback") =>
    apiFetch<{ ok: true; section: string; seen_at: number }>(
      "POST",
      "/api/admin/sidebar-badges/seen",
      { section },
    ),
};

export const vendorWaitlistApi = {
  submit: (body: SubmitVendorWaitlistInput) =>
    apiFetch<{ entry: VendorWaitlistEntry }>("POST", "/api/vendors/waitlist", body),
};

export interface FeedbackInput {
  /** Where the dialog was opened from. Defaults server-side to "landing"
   *  when omitted (back-compat). */
  source?: "landing" | "app";
  message?: string;
  rating?: number;
  monthly_value_ft?: number;
  from_email?: string;
  locale?: string;
}

export const feedbackApi = {
  submit: (body: FeedbackInput) => apiFetch<{ ok: true }>("POST", "/api/feedback", body),
};

export const adminFeedbackApi = {
  list: () => apiFetch<{ entries: FeedbackEntry[] }>("GET", "/api/admin/feedback"),
  setStatus: (id: number, status: FeedbackStatus) =>
    apiFetch<{ entry: FeedbackEntry }>("PATCH", `/api/admin/feedback/${id}/status`, { status }),
  remove: (id: number) => apiFetch<{ ok: true }>("DELETE", `/api/admin/feedback/${id}`),
};

export const adminVendorWaitlistApi = {
  list: () => apiFetch<{ entries: VendorWaitlistAdminView[] }>("GET", "/api/admin/vendor-waitlist"),
  /** Atomic decision: stamps the outcome on the row AND sends the template
   *  email to the supplier. The `subject` / `body` come from the admin's
   *  edits in the triage modal (pre-filled from `buildEmailDraft`). */
  decide: (id: number, body: DecideVendorWaitlistInput) =>
    apiFetch<{ entry: VendorWaitlistAdminView }>(
      "POST",
      `/api/admin/vendor-waitlist/${id}/decide`,
      body,
    ),
  /** Re-open a decided entry — status → 'new', clears outcome_at. Notes and
   *  the last-sent subject/body stay on the row. */
  reopen: (id: number) =>
    apiFetch<{ entry: VendorWaitlistAdminView }>(
      "POST",
      `/api/admin/vendor-waitlist/${id}/reopen`,
      {},
    ),
};

export const supplierTaxonomyApi = {
  list: () => apiFetch<SupplierTaxonomy>("GET", "/api/supplier-categories"),
};

export const adminSupplierTaxonomyApi = {
  createGroup: (body: CreateSupplierGroupInput) =>
    apiFetch<{ group: AdminSupplierGroup }>("POST", "/api/admin/supplier-groups", body),
  updateGroup: (id: number, body: UpdateSupplierGroupInput) =>
    apiFetch<{ group: AdminSupplierGroup }>("PATCH", `/api/admin/supplier-groups/${id}`, body),
  removeGroup: (id: number) => apiFetch<{ ok: true }>("DELETE", `/api/admin/supplier-groups/${id}`),
  createCategory: (body: CreateSupplierCategoryInput) =>
    apiFetch<{ category: AdminSupplierCategory }>("POST", "/api/admin/supplier-categories", body),
  updateCategory: (id: number, body: UpdateSupplierCategoryInput) =>
    apiFetch<{ category: AdminSupplierCategory }>(
      "PATCH",
      `/api/admin/supplier-categories/${id}`,
      body,
    ),
  removeCategory: (id: number) =>
    apiFetch<{ ok: true }>("DELETE", `/api/admin/supplier-categories/${id}`),
};

export const adminSupplierApi = {
  list: () => apiFetch<{ suppliers: CommunitySupplierAdminView[] }>("GET", "/api/admin/suppliers"),
  approve: (id: number) =>
    apiFetch<{ supplier: CommunitySupplierAdminView }>(
      "POST",
      `/api/admin/suppliers/${id}/approve`,
      {},
    ),
  enrich: (id: number) =>
    apiFetch<{ supplier: CommunitySupplierAdminView; fields_filled: number }>(
      "POST",
      `/api/admin/suppliers/${id}/enrich`,
      {},
    ),
  hide: (id: number, reason?: string) =>
    apiFetch<{ supplier: CommunitySupplierAdminView }>("POST", `/api/admin/suppliers/${id}/hide`, {
      reason: reason ?? null,
    }),
  unhide: (id: number) =>
    apiFetch<{ supplier: CommunitySupplierAdminView }>(
      "POST",
      `/api/admin/suppliers/${id}/unhide`,
      {},
    ),
  /** Persist freeform admin-only notes. Empty string clears. The admin
   *  moderation card edits this in place; the server caps payload length. */
  updateNotes: (id: number, notes: string) =>
    apiFetch<{ supplier: CommunitySupplierAdminView }>(
      "PATCH",
      `/api/admin/suppliers/${id}/notes`,
      { notes },
    ),
  remove: (id: number) => apiFetch<{ ok: true }>("DELETE", `/api/admin/suppliers/${id}`),
  /** Full directory (curated + community) with per-supplier visit analytics.
   *  Filters narrow the row set; analytics counters always span total/30d/7d. */
  listDirectory: (filters: AdminDirectoryFilters) =>
    apiFetch<{ suppliers: SupplierDirectoryAdminRow[]; filters: AdminDirectoryFilters }>(
      "GET",
      `/api/admin/suppliers/directory${buildDirectoryQuery(filters)}`,
    ),
  /** Streams the same filtered list as a CSV download. We hit `fetch` directly
   *  (not apiFetch) so the response stays as a Blob the caller can save. */
  exportDirectoryCsv: async (filters: AdminDirectoryFilters): Promise<Blob> => {
    const token = getToken();
    const res = await fetch(`/api/admin/suppliers/directory.csv${buildDirectoryQuery(filters)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) throw new Error(`CSV fetch failed: ${res.status}`);
    return res.blob();
  },
};

/** Serialise filters into a stable querystring. Drops empty / "all" values so
 *  the URL stays clean and the server's parser doesn't have to special-case
 *  them. Returns `""` when nothing's set so the path stays valid. */
function buildDirectoryQuery(f: AdminDirectoryFilters): string {
  const p = new URLSearchParams();
  if (f.source && f.source !== "all") p.set("source", f.source);
  if (f.status && f.status !== "all") p.set("status", f.status);
  if (f.category && f.category !== "all") p.set("category", f.category);
  if (f.city && f.city.trim().length > 0) p.set("city", f.city.trim());
  if (f.q && f.q.trim().length > 0) p.set("q", f.q.trim());
  if (typeof f.min_views === "number" && f.min_views > 0) {
    p.set("min_views", String(f.min_views));
  }
  if (typeof f.from === "number" && f.from) p.set("from", String(f.from));
  if (typeof f.to === "number" && f.to) p.set("to", String(f.to));
  const s = p.toString();
  return s.length > 0 ? `?${s}` : "";
}

/** Auth-protected PDF download as a Blob (so the caller can save with any
 *  filename). Accepts an optional `AbortSignal` so the caller can cancel a
 *  long-running render — the seating PDF can take ~10s on a slow box. */
export async function fetchPdfBlob(path: string, signal?: AbortSignal): Promise<Blob> {
  const token = getToken();
  const res = await fetch(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    signal,
  });
  if (!res.ok) throw new Error(`PDF fetch failed: ${res.status}`);
  return res.blob();
}

/** Build the place-cards URL. Supports the day-of "reprint just these guests"
 *  workflow — `guestIds` is the subset to render, deduped + capped at 200 by
 *  the server. When both filters are present the server intersects them. */
export function placeCardsUrl(opts: { onlyConfirmed?: boolean; guestIds?: number[] } = {}): string {
  const qs = new URLSearchParams();
  if (opts.onlyConfirmed) qs.set("only", "confirmed");
  if (opts.guestIds && opts.guestIds.length > 0) {
    qs.set("guest_ids", opts.guestIds.join(","));
  }
  const s = qs.toString();
  return s ? `/api/print/place-cards?${s}` : "/api/print/place-cards";
}

/** A4 portrait day-of run-of-show. Auth-protected; download via `fetchPdfBlob`. */
export const schedulePdfUrl = "/api/print/schedule";
