// One typed wrapper per HTTP call. Components import these — never `fetch` directly.

import type {
  AdminCoupleView,
  AdminUserView,
  AuthSession,
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
  DataExportSummary,
  GuestCountGoal,
  Guest,
  Household,
  PublicCheckinView,
  PublicRsvpView,
  SeatAssignment,
  SeatingConflict,
  SeatingTable,
  TableShape,
  User,
  WeddingDateGoal,
  WeddingStyleTag,
} from "@shared/types";
import type {
  CommunitySupplierAdminView,
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
  SubmitVendorWaitlistInput,
  VendorWaitlistEntry,
  VendorWaitlistStatus,
} from "@shared/vendor_waitlist";
import type { DirectorySupplier, SupplierCategory } from "@shared/suppliers";
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
  /** Legacy scalars — kept for one or two clients still on the old shape. */
  wedding_date?: string | null;
  target_guest_count?: number | null;
  budget_ceiling_huf?: number | null;
  location_lat?: number | null;
  location_lng?: number | null;
  location_radius_km?: number | null;
  style_tags: WeddingStyleTag[];
}

export const coupleApi = {
  current: () => apiFetch<{ couple: Couple | null }>("GET", "/api/couples/current"),
  partner: () => apiFetch<{ partner: CouplePartnerView | null }>("GET", "/api/couples/partner"),
  /** Last 14 days of partner-visible activity (saves, uploads, deletes,
   *  RSVPs, exports). Used by the Profile "activity" panel. */
  activity: () => apiFetch<{ entries: CoupleActivityEntry[] }>("GET", "/api/couples/activity"),
  onboard: (body: OnboardInput) =>
    apiFetch<{ couple: Couple }>("POST", "/api/couples/onboard", body),
  /** Partial update — supports `wedding_date_goal`, `budget_goal`, `ceremony_kind`. */
  update: (body: {
    wedding_date_goal?: WeddingDateGoal;
    budget_goal?: BudgetGoal;
    ceremony_kind?: CeremonyKind | null;
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
};

export interface GuestUpsert extends Partial<Guest> {
  /** Optional new household — paired with `household_id: null`, creates a
   *  household with this label and puts the guest in it. */
  new_household_label?: string;
  /** Tri-state flag for the "invited" checkbox: `true` stamps invited_at to
   *  now, `false` clears it, omitted leaves the field as-is. */
  invited?: boolean;
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

/** Per-user couple membership — today, just leaving a partner-B seat. */
export const userApi = {
  leaveCouple: () => apiFetch<{ ok: true }>("POST", "/api/users/me/leave-couple", {}),
};

export const householdApi = {
  list: () => apiFetch<{ households: Household[] }>("GET", "/api/households"),
  create: (body: { label: string; notes?: string | null }) =>
    apiFetch<{ household: Household }>("POST", "/api/households", body),
  update: (id: number, body: { label?: string; notes?: string | null }) =>
    apiFetch<{ household: Household }>("PATCH", `/api/households/${id}`, body),
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
  removeSnapshot: (id: number) => apiFetch<{ ok: true }>("DELETE", `/api/budget/snapshots/${id}`),
};

export const rsvpApi = {
  /** New airport-style check-in: couple slug + 4-digit household code. */
  lookup: (couple: string, code: string) =>
    apiFetch<{ rsvp: PublicCheckinView }>(
      "GET",
      `/api/rsvp/lookup?couple=${encodeURIComponent(couple)}&code=${encodeURIComponent(code)}`,
    ),
  /** Submit RSVPs for every member of the household in one shot. */
  checkin: (body: CheckinSubmitBody) =>
    apiFetch<{ rsvp: PublicCheckinView }>("POST", "/api/rsvp/checkin", body),
  /** Legacy per-guest invite_code path. Kept so old `/rsvp/<6char>` URLs
   *  printed on older invite cards keep resolving — server now returns the
   *  same household view. */
  legacyGet: (code: string) =>
    apiFetch<{ rsvp: PublicCheckinView }>("GET", `/api/rsvp/${encodeURIComponent(code)}`),
  /** @deprecated — single-guest legacy submit. New UI uses `checkin`. */
  legacySubmit: (code: string, body: Partial<PublicRsvpView>) =>
    apiFetch<{ rsvp: PublicRsvpView }>("POST", `/api/rsvp/${encodeURIComponent(code)}`, body),
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
   *  name, address, lat/lng, website, phone. Each field may be null. */
  resolveMapsUrl: (url: string) =>
    apiFetch<{
      place: {
        name: string | null;
        address: string | null;
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
  list: () => apiFetch<{ entries: VendorWaitlistEntry[] }>("GET", "/api/admin/vendor-waitlist"),
  setStatus: (id: number, status: VendorWaitlistStatus) =>
    apiFetch<{ entry: VendorWaitlistEntry }>("PATCH", `/api/admin/vendor-waitlist/${id}/status`, {
      status,
    }),
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
  remove: (id: number) => apiFetch<{ ok: true }>("DELETE", `/api/admin/suppliers/${id}`),
};

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

/** Build the place-cards URL. `onlyConfirmed=true` filters to RSVP=yes. */
export function placeCardsUrl(opts: { onlyConfirmed?: boolean } = {}): string {
  return opts.onlyConfirmed ? "/api/print/place-cards?only=confirmed" : "/api/print/place-cards";
}
