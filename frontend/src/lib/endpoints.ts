// One typed wrapper per HTTP call. Components import these — never `fetch` directly.

import type {
  AuthSession,
  BudgetGoal,
  BudgetLine,
  BudgetSnapshot,
  Couple,
  CoupleInvite,
  CouplePauseRequest,
  CoupleStatus,
  GuestCountGoal,
  Guest,
  PublicRsvpView,
  SeatAssignment,
  SeatingConflict,
  SeatingTable,
  TableShape,
  User,
  WeddingDateGoal,
  WeddingStyleTag,
} from "@shared/types";
import type { DirectorySupplier, SupplierCategory } from "@shared/suppliers";
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
  onboard: (body: OnboardInput) =>
    apiFetch<{ couple: Couple }>("POST", "/api/couples/onboard", body),
  createInvite: (body: { invited_email?: string }) =>
    apiFetch<{ invite: CoupleInvite }>("POST", "/api/couples/invites", body),
  getInvite: (token: string) =>
    apiFetch<{ invite: CoupleInvite; couple_display_name: string | null }>(
      "GET",
      `/api/invites/${encodeURIComponent(token)}`,
    ),
  acceptInvite: (token: string) =>
    apiFetch<{ couple: Couple }>("POST", `/api/invites/${encodeURIComponent(token)}/accept`, {}),
};

export const guestApi = {
  list: () => apiFetch<{ guests: Guest[] }>("GET", "/api/guests"),
  create: (body: Partial<Guest>) => apiFetch<{ guest: Guest }>("POST", "/api/guests", body),
  update: (id: number, body: Partial<Guest>) =>
    apiFetch<{ guest: Guest }>("PATCH", `/api/guests/${id}`, body),
  remove: (id: number) => apiFetch<{ ok: true }>("DELETE", `/api/guests/${id}`),
  importCsv: (csv: string) =>
    apiFetch<{ created_count: number; errors: { row: number; reason: string }[] }>(
      "POST",
      "/api/guests/import",
      { csv },
    ),
};

export const budgetApi = {
  listLines: () => apiFetch<{ lines: BudgetLine[] }>("GET", "/api/budget/lines"),
  createLine: (body: Partial<BudgetLine>) =>
    apiFetch<{ line: BudgetLine }>("POST", "/api/budget/lines", body),
  updateLine: (id: number, body: Partial<BudgetLine>) =>
    apiFetch<{ line: BudgetLine }>("PATCH", `/api/budget/lines/${id}`, body),
  removeLine: (id: number) => apiFetch<{ ok: true }>("DELETE", `/api/budget/lines/${id}`),
  listSnapshots: () => apiFetch<{ snapshots: BudgetSnapshot[] }>("GET", "/api/budget/snapshots"),
  createSnapshot: (body: { name: string }) =>
    apiFetch<{ snapshot: BudgetSnapshot }>("POST", "/api/budget/snapshots", body),
  removeSnapshot: (id: number) => apiFetch<{ ok: true }>("DELETE", `/api/budget/snapshots/${id}`),
};

export const rsvpApi = {
  get: (code: string) =>
    apiFetch<{ rsvp: PublicRsvpView }>("GET", `/api/rsvp/${encodeURIComponent(code)}`),
  submit: (code: string, body: Partial<PublicRsvpView>) =>
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
  }) => apiFetch<{ table: SeatingTable }>("POST", "/api/seating/tables", body),
  updateTable: (id: number, body: Partial<SeatingTable>) =>
    apiFetch<{ table: SeatingTable }>("PATCH", `/api/seating/tables/${id}`, body),
  removeTable: (id: number) => apiFetch<{ ok: true }>("DELETE", `/api/seating/tables/${id}`),
  assign: (body: { table_id: number; seat_index: number; guest_id: number }) =>
    apiFetch<{ ok: true }>("POST", "/api/seating/assign", body),
  unassign: (guest_id: number) =>
    apiFetch<{ ok: true }>("POST", "/api/seating/unassign", { guest_id }),
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
  /** GDPR Article 20: returns a JSON blob with everything the couple owns. */
  download: () => apiFetch<Record<string, unknown>>("GET", "/api/couples/export"),
};

export const supplierApi = {
  list: (category?: SupplierCategory) =>
    apiFetch<{ suppliers: DirectorySupplier[] }>(
      "GET",
      category ? `/api/suppliers?category=${category}` : "/api/suppliers",
    ),
};

/** Auth-protected PDF download as a Blob (so the caller can save with any filename). */
export async function fetchPdfBlob(path: string): Promise<Blob> {
  const token = getToken();
  const res = await fetch(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) throw new Error(`PDF fetch failed: ${res.status}`);
  return res.blob();
}
