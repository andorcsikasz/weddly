// One typed wrapper per HTTP call. Components import these — never `fetch` directly.

import type {
  Accommodation,
  AccommodationRoom,
  AdminCoupleView,
  AdminEmailEntry,
  AdminEmailListResponse,
  AdminEmailLogEntry,
  AdminSidebarBadges,
  AdminUserView,
  AuthSession,
  BudgetCategory,
  BudgetDocument,
  BudgetGoal,
  BudgetLine,
  BudgetPayment,
  BudgetSnapshot,
  CoupleIncome,
  CreateCoupleIncomeInput,
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
  GuestMessage,
  GuestMessageAudience,
  GuestMessageTemplate,
  EnvelopeTip,
  Household,
  FilmAccessCheck,
  FilmAesthetic,
  FilmDevice,
  FilmUpload,
  MealMenu,
  MediaLinks,
  PhotoAlbum,
  PhotoAlbumPublic,
  MoodboardPin,
  MoodboardState,
  PlaceSuggestion,
  PublicCheckinView,
  PublicRsvpView,
  SeatAssignment,
  SeatingConflict,
  SeatingTable,
  TableShape,
  Transfer,
  UpdateCoupleIncomeInput,
  UpsertAccommodationInput,
  UpsertAccommodationRoomInput,
  UpsertTransferInput,
  User,
  WeddingDateGoal,
  WeddingStyleTag,
  PlannerClientView,
  PlannerInviteBatchResult,
  PlannerClientCrm,
  PlannerClientNote,
  PlannerBoardStatus,
  PlannerTaskRow,
  PlannerThreadPreview,
  PlannerMessage,
  PlannerProfile,
  PlannerAvailabilityView,
  PlannerPortfolioItem,
  LinkedPlannerView,
  PlannerDirectoryDetail,
  PlannerDirectoryEntry,
  PlannerEventInput,
  PlannerInviteView,
  PlannerInvitation,
  PlannerInvitePublic,
  PlannerStats,
  PlannerEvent,
  AdminPlannerView,
  AdminProvisionPlannerInput,
  PlannerActivationView,
  PlannerPlan,
} from "@shared/types";
import type {
  AdminFinancialPlannerOverview,
  FxRates,
  StripeHealth,
} from "@shared/admin_financial_planner";
import type { BillingStatusResponse, PaymentMethodResponse } from "@shared/billing";
import type { GrowthEventKind } from "@shared/growth";
import type { CompanyLookupAvailability, CompanyLookupResult } from "@shared/company_lookup";
import type { TranslateAvailability, TranslateRequest, TranslateResult } from "@shared/translate";
import type { AddressSuggestion } from "@shared/geo";
import type { PlannerBillingStatus } from "@shared/planner_billing";
import type { CoupleDesignInput } from "@shared/design";
import type { BlogPost } from "@shared/blog_posts";
import type { GuestPortalView } from "@shared/guest_portal";
import type { PublicWeddingResponse } from "@shared/wedding_website";
import type { ReceivedGift, UpsertReceivedGiftInput } from "@shared/received_gifts";
import type { ScheduleEvent, UpsertScheduleEventInput } from "@shared/schedule";
import type {
  UpsertWishlistItemInput,
  WishlistContributorsResult,
  WishlistInterestToggleResult,
  WishlistItem,
  WishlistLinkPreview,
} from "@shared/wishlist";
import type {
  CommunitySupplierAdminView,
  CommunitySupplierReportReason,
  SubmitCommunitySupplierInput,
  SupplierNameCheckResponse,
} from "@shared/community_suppliers";
import type {
  CoupleSupplier,
  CreateCoupleSupplierInput,
  CreateInstallmentInput,
  UpdateCoupleSupplierInput,
  UpdateInstallmentInput,
} from "@shared/couple_suppliers";
import type { CoupleSupplierCost, UpsertCoupleSupplierCostInput } from "@shared/supplier_costs";
import type {
  FeedbackEntry,
  FeedbackPriority,
  FeedbackReplyChannel,
  FeedbackStatus,
} from "@shared/feedback";
import type {
  DecideVendorWaitlistInput,
  VendorWaitlistAdminView,
  VendorWaitlistEntry,
} from "@shared/vendor_waitlist";
import type {
  DecidePlannerWaitlistInput,
  PlannerWaitlistAdminView,
} from "@shared/planner_waitlist";
import type { CouplePick } from "@shared/picks";
import type { SavedSupplier } from "@shared/saved";
import type {
  AdminAcquisitionAnalytics,
  AdminActivityAnalytics,
  AdminCampaignAnalytics,
  AdminDemoAnalytics,
  AdminEngagementAnalytics,
  AdminGuestAnalytics,
  AdminHoneymoonAnalytics,
  AdminMoneyAnalytics,
  AdminPicksAnalytics,
  AdminPlannerAnalytics,
  AdminTrafficAnalytics,
  AdminUserAnalytics,
  AdminWeddingAnalytics,
  AnalyticsAudience,
} from "@shared/admin_analytics";
import type {
  AdminDirectoryFilters,
  AdminFlaggedReviewsResponse,
  CommentListResponse,
  CreateBookingBody,
  CreateCommentBody,
  CreateReviewBody,
  DirectorySupplier,
  PublicVendorPageData,
  PublicVendorSearchResult,
  PublicVendorShowcase,
  ReviewListResponse,
  SupplierAvailability,
  SupplierBooking,
  SupplierCategory,
  SupplierComment,
  SupplierCountryCount,
  SupplierDetail,
  SupplierDirectoryAdminRow,
  SupplierEventInput,
  SupplierReview,
} from "@shared/suppliers";
import type { VisitorSession } from "@shared/verified_visitors";
import type {
  AdminSupplierCategory,
  AdminSupplierGroup,
  CreateSupplierCategoryInput,
  CreateSupplierGroupInput,
  SupplierTaxonomy,
  UpdateSupplierCategoryInput,
  UpdateSupplierGroupInput,
} from "@shared/supplier_taxonomy";
import type {
  CreateVendorCampaignInput,
  UpdateVendorCampaignInput,
  VendorCampaign,
  VendorCampaignDetail,
  VendorCampaignSegments,
  VendorCampaignSend,
  VendorCampaignStats,
  VendorCampaignTarget,
} from "@shared/vendor_campaign";
import type {
  CreateVendorReviewCampaignInput,
  UpdateVendorReviewCampaignInput,
  VendorReviewCampaign,
  VendorReviewCampaignDetail,
  VendorReviewCampaignSegments,
  VendorReviewCampaignSend,
  VendorReviewCampaignStats,
  VendorReviewCampaignTarget,
} from "@shared/vendor_review_campaign";
import type {
  CreateOnboardingCampaignInput,
  OnboardingCampaign,
  OnboardingCampaignDetail,
  OnboardingCampaignSend,
  OnboardingCampaignStats,
  OnboardingCampaignSyncResult,
  UpdateOnboardingCampaignInput,
} from "@shared/onboarding_campaign";
import type {
  CampaignPlanView,
  CampaignScheduleView,
  UpdateCampaignScheduleInput,
} from "@shared/campaign_schedules";
import type {
  CreatePersonalInviteCampaignInput,
  ImportPersonalInviteContactsInput,
  PersonalInviteCampaign,
  PersonalInviteCampaignDetail,
  PersonalInviteCampaignSend,
  PersonalInviteCampaignStats,
  PersonalInviteImportResult,
  UpdatePersonalInviteCampaignInput,
} from "@shared/personal_invite_campaign";
import type { ClaimVerifyView, CompleteClaimInput, StartClaimInput } from "@shared/vendor_claim";
import type {
  CompleteVendorOnboardingInput,
  VendorOnboardingVerifyView,
} from "@shared/vendor_onboarding";
import type { PublicVendorStats, VendorBillingStatus } from "@shared/vendor_billing";
import type { VendorFeatureFlags, VendorPlan } from "@shared/vendor_plan";
import type {
  VendorBoardStatus,
  VendorTask,
  VendorTaskCreateInput,
  VendorTaskUpdateInput,
} from "@shared/vendor_tasks";
import type {
  VendorClientDetail,
  VendorClientPayment,
  VendorClientView,
  VendorStats,
} from "@shared/vendor_clients";
import type { VendorPointsStatus } from "@shared/vendor_points";
import type {
  AdminVendorView,
  VendorAccount,
  VendorAccountEditInput,
  VendorAvailabilityView,
  VendorDataExport,
  VendorListingEditInput,
  VendorListingView,
} from "@shared/listings";
import type {
  CreateOutreachCampaignInput,
  OutreachCampaign,
  OutreachCampaignDetail,
} from "@shared/outreach";
import { ApiError, apiFetch, getToken } from "./api";

/** Multipart upload helper — JSON-shaped `apiFetch` can't send FormData, so we
 *  call fetch directly with the same Bearer auth (the browser sets the
 *  multipart Content-Type + boundary). Mirrors the per-endpoint upload blocks. */
async function uploadMultipart<T>(
  method: "POST" | "PATCH",
  path: string,
  form: FormData,
): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const text = await res.text();
  if (!res.ok) {
    let parsed: { code?: string; message?: string } | null = null;
    try {
      parsed = text ? (JSON.parse(text) as { code?: string; message?: string }) : null;
    } catch {
      parsed = null;
    }
    throw new ApiError(
      res.status,
      res.status >= 500 ? "server_error" : "client_error",
      parsed?.message ?? text ?? "Upload failed",
      parsed,
    );
  }
  return JSON.parse(text) as T;
}

/** Public landing-page counters — real onboarded couples + guests who have
 *  submitted any RSVP (yes / no / maybe). Cached server-side for 60s. */
export const publicStatsApi = {
  get: () => apiFetch<{ couples: number; rsvps: number; ts: number }>("GET", "/api/public/stats"),
  /** Vendor-recruitment counters for the public /vendors page: couples
   *  planning right now, inquiry volume over the last 30 days, and the free
   *  window a signup would land in (with its remaining slots). */
  vendors: () => apiFetch<PublicVendorStats>("GET", "/api/public/vendor-stats"),
};

/** Public newsletter capture (landing + blog). Double opt-in: subscribe only
 *  triggers a confirmation email; confirm/unsubscribe consume the emailed
 *  token. Subscribe always resolves ok — the server never reveals whether an
 *  address is already on the list. */
export const newsletterApi = {
  subscribe: (payload: {
    email: string;
    locale: "hu" | "en";
    source: string;
    privacy_version: string;
  }) => apiFetch<{ ok: true }>("POST", "/api/newsletter/subscribe", payload),
  confirm: (token: string) =>
    apiFetch<{ ok: true; already: boolean }>("POST", "/api/newsletter/confirm", { token }),
  unsubscribe: (token: string) =>
    apiFetch<{ ok: true; already: boolean }>("POST", "/api/newsletter/unsubscribe", { token }),
};

/** Public blog index + per-slug detail. Drafts (`is_published = false`) are
 *  excluded server-side, so any post the caller receives is safe to render. */
export const blogApi = {
  list: () => apiFetch<{ posts: BlogPost[] }>("GET", "/api/blog/posts"),
  get: (slug: string) =>
    apiFetch<{ post: BlogPost }>("GET", `/api/blog/posts/${encodeURIComponent(slug)}`),
};

/** Admin-only CRUD on blog posts. Mirrors `blogApi` but includes drafts +
 *  write operations. Server gates every endpoint with `requireAdmin`. */
export const adminBlogApi = {
  list: () => apiFetch<{ posts: BlogPost[] }>("GET", "/api/admin/blog/posts"),
  get: (id: number) => apiFetch<{ post: BlogPost }>("GET", `/api/admin/blog/posts/${id}`),
  create: (payload: AdminBlogPostPayload) =>
    apiFetch<{ post: BlogPost }>("POST", "/api/admin/blog/posts", payload),
  update: (id: number, payload: AdminBlogPostPayload) =>
    apiFetch<{ post: BlogPost }>("PUT", `/api/admin/blog/posts/${id}`, payload),
  remove: (id: number) => apiFetch<{ ok: true }>("DELETE", `/api/admin/blog/posts/${id}`),
  clearCover: (id: number) =>
    apiFetch<{ post: BlogPost }>("DELETE", `/api/admin/blog/posts/${id}/cover`),
  uploadCover: async (id: number, file: File): Promise<{ post: BlogPost }> => {
    const form = new FormData();
    form.append("file", file);
    const token = getToken();
    const res = await fetch(`/api/admin/blog/posts/${id}/cover`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    const text = await res.text();
    if (!res.ok) {
      let parsed: { code?: string; message?: string } | null = null;
      try {
        parsed = text ? (JSON.parse(text) as { code?: string; message?: string }) : null;
      } catch {
        parsed = null;
      }
      throw new ApiError(
        res.status,
        res.status >= 500 ? "server_error" : "client_error",
        parsed?.message ?? text ?? "Upload failed",
        parsed,
      );
    }
    return JSON.parse(text) as { post: BlogPost };
  },
};

export interface AdminBlogPostPayload {
  slug: string;
  published_at: string;
  read_minutes: number;
  cover_image_url: string | null;
  is_published: boolean;
  hu: {
    category: string;
    title: string;
    lead: string;
    seo_title: string;
    seo_description: string;
    body: import("@shared/blog_posts").BlogBlock[];
  };
  en: {
    category: string;
    title: string;
    lead: string;
    seo_title: string;
    seo_description: string;
    body: import("@shared/blog_posts").BlogBlock[];
  };
}

/** Public landing-page "try the demo" endpoint. Spins up a brand-new
 *  Shrek & Fiona workspace and returns a session token. No registration,
 *  no email. The returned `couple.is_demo` is what the /app UI keys off
 *  to render the demo banner + conversion popup. */
export const demoApi = {
  /** `locale` is the SPA's active UI locale — the backend seeds the demo
   *  dataset (guests, tasks, notes, messages) in that language so the demo
   *  content matches the chrome around it. */
  start: (locale: "hu" | "en") =>
    apiFetch<{
      session: AuthSession;
      couple: Couple | null;
      seeded: Record<string, number>;
    }>("POST", "/api/demo/start", { locale }),
  /** Planner-side demo: spins up a "Fairy Godmother Weddings" planner account
   *  pre-loaded with a book of fairy-tale clients and returns a session token.
   *  No couple — the planner manages many. Drop the visitor into /app/planner. */
  startPlanner: (locale: "hu" | "en") =>
    apiFetch<{
      session: AuthSession;
      seeded: Record<string, number>;
    }>("POST", "/api/demo/planner/start", { locale }),
  /** Vendor-side demo: spins up a Shrek-themed "Mézi Tortaműhely" / "Gingy's
   *  Wedding Cakes" vendor account pre-loaded with fairy-tale client inquiries
   *  and returns a session token. Drop the visitor into /vendor. */
  startVendor: (locale: "hu" | "en") =>
    apiFetch<{
      session: AuthSession;
      seeded: Record<string, number>;
    }>("POST", "/api/demo/vendor/start", { locale }),
};

export const authApi = {
  register: (body: {
    email: string;
    password: string;
    full_name: string;
    privacy_version: string;
    terms_version: string;
    /** Current UI locale, persisted on users.locale so the user's preference
     *  survives across devices. Backend only stores 'hu' | 'en'. */
    locale?: "hu" | "en";
    /** Funnel attribution: which public surface drove the signup. The
     *  LandingPage extracts this from `?ref=<source>` and stashes to
     *  sessionStorage; RegisterPage hands it off. Backend allow-list:
     *  `rsvp` | `site` | `share`. */
    referrer?: string;
    /** Marketing attribution: UTM params the LandingPage read off the landing
     *  URL and stashed to sessionStorage. Backend coerces + length-caps each;
     *  stored on users.utm_* for the admin Acquisition dashboard. */
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    utm_content?: string;
    utm_term?: string;
    /** Planner email-invitation token from `?planner_invite=…` on the signup
     *  link. Re-binds the pending invitation to this account so the onboarding
     *  hook links the couple to the inviting planner (pending their approval). */
    planner_invite?: string;
    /** Parks a pending signup and mails a verify link. Deliberately does NOT
     *  return a session: no account exists until the link is clicked (the
     *  signup waits in `pending_signups` server-side), and clicking it is what
     *  mints the user + signs them in. See `consumeVerify`. */
  }) => apiFetch<{ pending: true; email: string }>("POST", "/api/auth/register", body),
  /** Sign in OR register with a Google Identity Services credential JWT.
   *  Both version stamps are required so the GDPR consent ledger lands when
   *  this call creates a brand-new account; the server ignores them when the
   *  credential maps to an existing user. */
  google: (body: {
    credential: string;
    privacy_version: string;
    terms_version: string;
    /** Same persistence semantics as `register.locale` — only applied to
     *  brand-new accounts; ignored when the credential matches an
     *  existing user. */
    locale?: "hu" | "en";
  }) => apiFetch<AuthSession>("POST", "/api/auth/google", body),
  /** Sign in OR register with a Sign in with Apple `id_token` JWT. Apple omits
   *  the display name from the token and only hands it to the JS client on the
   *  first authorization, so `full_name` is forwarded separately (display only,
   *  applied to brand-new accounts). Both version stamps are required so the
   *  GDPR consent ledger lands when this creates a brand-new account; the
   *  server ignores them when the credential maps to an existing user. */
  apple: (body: {
    credential: string;
    full_name?: string;
    privacy_version: string;
    terms_version: string;
    /** Same persistence semantics as `register.locale` — only applied to
     *  brand-new accounts; ignored when the credential matches an
     *  existing user. */
    locale?: "hu" | "en";
  }) => apiFetch<AuthSession>("POST", "/api/auth/apple", body),
  login: (body: { email: string; password: string }) =>
    apiFetch<AuthSession>("POST", "/api/auth/login", body),
  logout: () => apiFetch<{ ok: true }>("POST", "/api/auth/logout"),
  me: () => apiFetch<{ user: User }>("GET", "/api/auth/me"),
  /** Persist an explicit locale-switcher pick on users.locale so the choice
   *  survives sign-out and follows the account to fresh devices. */
  setLocale: (locale: "hu" | "en") =>
    apiFetch<{ user: User }>("POST", "/api/auth/locale", { locale }),
  /** Latch `users.share_prompt_seen_at` so the automatic share prompt never
   *  fires again for this ACCOUNT, on any device. Write-once server-side; safe
   *  to call more than once. */
  markSharePromptSeen: () => apiFetch<{ user: User }>("POST", "/api/auth/share-prompt-seen", {}),
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
  /** Unauthenticated resend keyed by email — for users the login gate blocks
   *  before they hold a session. Always resolves `{ ok: true }` regardless of
   *  whether the address exists (no account enumeration). */
  requestVerifyPublic: (email: string) =>
    apiFetch<{ ok: true }>("POST", "/api/auth/verify/request-public", { email }),
  /** Consume a verification link. Two shapes come back, because two kinds of
   *  link exist:
   *   - A pending signup (the normal password-register path): the click MINTS
   *     the account, so the response is a full `AuthSession` — store it and the
   *     user is signed in.
   *   - An account that already existed but was unverified (vendor register,
   *     a resend, any pre-pending_signups user): `{ ok: true }`, no session.
   *  Discriminate on the presence of `token`. */
  verifyEmail: (token: string) =>
    apiFetch<AuthSession | { ok: true }>(
      "POST",
      `/api/auth/verify/${encodeURIComponent(token)}`,
      {},
    ),
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
  /** ISO 3166-1 alpha-2 country code where the wedding will be held. */
  country?: string;
  /** Legacy scalars — kept for one or two clients still on the old shape. */
  wedding_date?: string | null;
  target_guest_count?: number | null;
  budget_ceiling_huf?: number | null;
  location_lat?: number | null;
  location_lng?: number | null;
  location_radius_km?: number | null;
  style_tags: WeddingStyleTag[];
  /** Referral invite code from ?ref_code= on the registration URL. */
  ref_code?: string;
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
  has_partner: boolean;
}

export interface ReferralStats {
  couple_refs: number;
  vendor_refs: number;
  bonus_months: number;
}

export interface ReferralStatus {
  code: string;
  couple_url: string;
  vendor_url: string;
  stats: ReferralStats;
}

export const referralApi = {
  get: () => apiFetch<ReferralStatus>("GET", "/api/referral"),
};

export const billingApi = {
  /** Current subscription snapshot + price + founding spots for the couple. */
  status: () => apiFetch<BillingStatusResponse>("GET", "/api/billing/status"),
  /** Start a Stripe-hosted Checkout — returns the redirect URL. */
  checkout: () => apiFetch<{ url: string }>("POST", "/api/billing/checkout", {}),
  /** Buy the 70%-off guest-page (vendégoldal) edit add-on for a planner-managed
   *  couple — returns the Stripe Checkout redirect URL. */
  guestPageAddonCheckout: () =>
    apiFetch<{ url: string }>("POST", "/api/billing/guest-page-addon/checkout", {}),
  /** Open the Stripe Billing Portal — returns the redirect URL. */
  portal: () => apiFetch<{ url: string }>("POST", "/api/billing/portal", {}),
  /** Read-only card on file (brand/last-4/expiry) for the in-app display; the
   *  card itself is only editable in the portal. `{ card: null }` when none. */
  paymentMethod: () => apiFetch<PaymentMethodResponse>("GET", "/api/billing/payment-method"),
};

export const plannerBillingApi = {
  /** Current planner subscription snapshot + per-tier prices + founding spots. */
  status: () => apiFetch<PlannerBillingStatus>("GET", "/api/planner/billing"),
  /** Start a Stripe-hosted Checkout for a tier — returns the redirect URL. */
  checkout: (tier: PlannerPlan) =>
    apiFetch<{ url: string }>("POST", "/api/planner/billing/checkout", { tier }),
  /** Open the Stripe Billing Portal — returns the redirect URL. */
  portal: () => apiFetch<{ url: string }>("POST", "/api/planner/billing/portal", {}),
};

/** A vendor the couple picked and hasn't reviewed yet — feeds /app/rate-vendors. */
export interface VendorToReview {
  id: string;
  name: string;
  category: string;
}

export const coupleApi = {
  current: () => apiFetch<{ couple: Couple | null }>("GET", "/api/couples/current"),
  /** Vendors the couple picked and hasn't reviewed yet (post-wedding prompt). */
  vendorsToReview: () =>
    apiFetch<{ vendors: VendorToReview[] }>("GET", "/api/couples/current/vendors-to-review"),
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
    /** ISO 3166-1 alpha-2 country for the new event. Falls back to the
     *  active workspace's country server-side when omitted. */
    country?: string;
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
    /** Pin/unpin the cost-planning headcount slider on /app/budget. */
    planning_count_locked?: boolean;
    frozen_categories?: BudgetCategory[];
    currency?: Currency;
    /** ISO 3166-1 alpha-2 country code. Drives supplier region filtering. */
    country?: string;
    rsvp_offers_accommodation?: boolean;
    rsvp_collects_meal?: boolean;
    /** Per-couple meal menu (custom labels + offered flags for the six
     *  fixed slots). Normalised + validated server-side. */
    meal_menu?: MealMenu;
    /** Proactive-timeline email escalation trigger. */
    timeline_email_escalation?: import("@shared/notifications").TimelineEmailEscalation;
    /** Email digest frequency. */
    notif_email_cadence?: import("@shared/notifications").NotifEmailCadence;
    /** Comma-separated focus areas: 'timeline', 'rsvp', 'partner'. */
    notif_focus?: string;
    /** Publish toggle for the public wedding website at `/w/:slug`. */
    is_public?: boolean;
    /** Gift-list publish toggle. When true the confirmed-tier guest page
     *  shows the wishlist with a warm intro; false keeps it couple-only. */
    wishlist_published?: boolean;
    /** Free-text venue name shown on the public wedding site. */
    venue_name?: string | null;
    /** City/town shown next to the venue name. */
    venue_city?: string | null;
    /** Kulcsinfó venue + day-of contacts (private dashboard panel). Empty
     *  string clears. */
    venue_address?: string | null;
    venue_phone?: string | null;
    coordinator_name?: string | null;
    coordinator_phone?: string | null;
    emergency_name?: string | null;
    emergency_phone?: string | null;
    /** Exact venue coordinates for the site map pin. Sent as a pair (both
     *  numbers to set, both null to clear) by the guest-page venue picker. */
    location_lat?: number | null;
    location_lng?: number | null;
    /** http(s) URL the couple pastes for the wedding site's hero image. */
    cover_image_url?: string | null;
    /** Cover-photo focal point as object-position percentages (0..100). */
    cover_position_x?: number;
    cover_position_y?: number;
    /** Cover-photo zoom (percent, 100 = fit-to-frame, up to 300). */
    cover_scale?: number;
    /** Pre-RSVP welcome block on the merged Vendégoldal (markdown,
     *  ≤4000 chars). Empty string clears the column. */
    guest_page_intro?: string | null;
    /** "Good to know" block (markdown, ≤6000 chars). Empty string clears. */
    useful_info?: string | null;
    /** Post-RSVP unlocked block (markdown, ≤8000 chars). Empty string
     *  clears the column. */
    post_rsvp_content?: string | null;
    /** Exact wedding date (YYYY-MM-DD). The backend folds a present scalar
     *  into an `exact` wedding_date_goal; null sets it back to TBD. The
     *  guest-page editor sets this when the couple edits the hero date. */
    wedding_date?: string | null;
    /** Wedding-day Welcome Desk mode toggle. Persistent on the couple
     *  row so the Settings card shows a stable status across reloads. */
    welcome_desk_active?: boolean;
    /** Photos page photo-share links. Partial — only the sources present
     *  are updated; "" / null clears that slot. */
    media_links?: Partial<MediaLinks>;
    /** Design feature — curated visual identity. Partial: any of the slugs
     *  + print toggles; only the keys present are updated. */
    design?: CoupleDesignInput;
  }) => apiFetch<{ couple: Couple }>("PATCH", "/api/couples/current", body),
  /** Multipart cover-image upload — mirrors vendorListingApi.uploadHero.
   *  Server writes the file to `${UPLOADS_DIR}/couples/<id>/cover.<ext>` and
   *  persists the resulting `/uploads/...` URL into `couples.cover_image_url`
   *  in the same transaction, so the returned couple is already the final
   *  state. JSON-shaped `apiFetch` doesn't speak FormData, so we hit fetch
   *  directly with the same auth header. Accepts JPEG/PNG/WebP up to 4 MB. */
  uploadCover: async (file: File): Promise<{ couple: Couple }> => {
    const form = new FormData();
    form.append("file", file);
    const token = getToken();
    const res = await fetch("/api/couples/current/cover", {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    const text = await res.text();
    if (!res.ok) {
      let parsed: { code?: string; message?: string } | null = null;
      try {
        parsed = text ? (JSON.parse(text) as { code?: string; message?: string }) : null;
      } catch {
        parsed = null;
      }
      throw new ApiError(
        res.status,
        res.status >= 500 ? "server_error" : "client_error",
        parsed?.message ?? text ?? "Upload failed",
        parsed,
      );
    }
    return JSON.parse(text) as { couple: Couple };
  },
  /** Multipart upload for one of the two OPTIONAL fixed-slot site photos
   *  (slot 1 renders after the welcome band, slot 2 before the RSVP ask).
   *  Same FormData-over-fetch pattern as uploadCover above. */
  uploadSitePhoto: async (slot: 1 | 2, file: File): Promise<{ couple: Couple }> => {
    const form = new FormData();
    form.append("file", file);
    const token = getToken();
    const res = await fetch(`/api/couples/current/site-photo/${slot}`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    const text = await res.text();
    if (!res.ok) {
      let parsed: { code?: string; message?: string } | null = null;
      try {
        parsed = text ? (JSON.parse(text) as { code?: string; message?: string }) : null;
      } catch {
        parsed = null;
      }
      throw new ApiError(
        res.status,
        res.status >= 500 ? "server_error" : "client_error",
        parsed?.message ?? text ?? "Upload failed",
        parsed,
      );
    }
    return JSON.parse(text) as { couple: Couple };
  },
  /** Clear a fixed-slot site photo (deletes the stored file too). */
  deleteSitePhoto: (slot: 1 | 2) =>
    apiFetch<{ couple: Couple }>("DELETE", `/api/couples/current/site-photo/${slot}`),
  /** Drop a curated design background into a slot instead of uploading. `slug`
   *  is one of shared/design.ts CURATED_SITE_PHOTOS; the server whitelists it
   *  and stores the matching `/design-photos/...` asset path. */
  chooseSitePhotoPreset: (slot: 1 | 2, slug: string) =>
    apiFetch<{ couple: Couple }>("POST", `/api/couples/current/site-photo/${slot}/preset`, {
      slug,
    }),
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
  /** Create-only opt-in for the new household's `rsvp_offers_accommodation`
   *  flag. Set true to ask "needs accommodation?" on this household's public
   *  RSVP form. Ignored unless a new household is being created via
   *  `new_household_label`. */
  new_household_offers_accommodation?: boolean;
  /** Tri-state flag for the "invited" checkbox: `true` stamps invited_at to
   *  now, `false` clears it, omitted leaves the field as-is. */
  invited?: boolean;
  /** Same shape as `invited`, but for the "invitation handed over" stamp.
   *  `true` implies invited=true server-side. */
  delivered?: boolean;
  /** Create-only — `true` fires a `guest_invite` email with a one-click
   *  /rsvp/{invite_code} link. Requires `email` to be set on the guest;
   *  silently ignored otherwise. Implies `invited=true` on the resulting
   *  row. */
  send_invite?: boolean;
  /** Explicit "online invite sent" channel mark (invites page). `true` stamps
   *  `invited_online_at` (and `invited_at` if unset), `false` clears it. */
  invited_online?: boolean;
  /** Explicit "physically handed over / in person" channel mark. `true` stamps
   *  `invited_physical_at` (and `invitation_delivered_at` + `invited_at`),
   *  `false` clears it. */
  invited_physical?: boolean;
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

/** Moodboard — the couple's board state lives on the couple row (preset /
 *  linked Pinterest board / own uploads), so both partners see the same thing.
 *  `preview` proxies a Pinterest board's RSS feed; the backend distinguishes
 *  private/missing/empty boards so the page can show a specific error. */
export const moodboardApi = {
  /** Persisted state for the current couple: source + linked url + preset url
   *  + uploaded images. */
  get: () => apiFetch<MoodboardState>("GET", "/api/moodboard"),
  preview: (url: string) =>
    apiFetch<{ pins: MoodboardPin[] }>(
      "GET",
      `/api/moodboard/preview?url=${encodeURIComponent(url)}`,
    ),
  /** Switch to the curated preset, or link the couple's own Pinterest board. */
  setSource: (body: { source: "preset" | "pinterest"; url?: string }) =>
    apiFetch<MoodboardState>("PATCH", "/api/moodboard", body),
  /** Multipart upload of own images (JPEG/PNG/WebP, ≤4 MB each). JSON-shaped
   *  `apiFetch` doesn't speak FormData, so we hit fetch directly with the same
   *  auth header — mirrors `coupleApi.uploadCover`. Flips source to 'upload'. */
  uploadImages: async (files: File[]): Promise<MoodboardState> => {
    const form = new FormData();
    for (const file of files) form.append("file", file);
    const token = getToken();
    const res = await fetch("/api/moodboard/images", {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    const text = await res.text();
    if (!res.ok) {
      let parsed: { code?: string; message?: string } | null = null;
      try {
        parsed = text ? (JSON.parse(text) as { code?: string; message?: string }) : null;
      } catch {
        parsed = null;
      }
      throw new ApiError(
        res.status,
        res.status >= 500 ? "server_error" : "client_error",
        parsed?.message ?? text ?? "Upload failed",
        parsed,
      );
    }
    return JSON.parse(text) as MoodboardState;
  },
  /** Remove one uploaded image; the server flips back to 'preset' when the last
   *  one goes. */
  deleteImage: (id: number) => apiFetch<MoodboardState>("DELETE", `/api/moodboard/images/${id}`),
};

/** Place-name autocomplete — proxies OpenStreetMap Nominatim. Pass `country`
 *  (ISO 3166-1 alpha-2) to restrict results to one country, e.g. the venue-name
 *  field scoping to the couple's country. Honeymoon search omits it on purpose. */
export const placesApi = {
  /** `kind: "venue"` keeps the POI name as the headline (e.g. "Sári Csárda")
   *  instead of collapsing the result to its settlement — used by the
   *  venue-name field. The honeymoon destination picker omits it. */
  search: (q: string, country?: string, kind?: "venue") => {
    const cc = country && /^[a-z]{2}$/i.test(country) ? `&country=${country.toLowerCase()}` : "";
    const k = kind === "venue" ? "&kind=venue" : "";
    return apiFetch<{ places: PlaceSuggestion[] }>(
      "GET",
      `/api/places/search?q=${encodeURIComponent(q)}${cc}${k}`,
    );
  },
};

/** Honeymoon-specific server state. Right now only the Amadeus flight
 *  estimate; destination + dates ride along on /api/couples. The estimate is
 *  server-cached for 12 h, so calling this from a page mount is cheap. */
export const honeymoonApi = {
  flightEstimate: () =>
    apiFetch<{ estimate: FlightEstimate | null }>("GET", "/api/honeymoon/flight-estimate"),
  /** Official Hungarian consular travel advice for the couple's destination.
   *  The server reads the saved destination off the couple row; pass an
   *  override to preview advice for a not-yet-saved destination. Never errors
   *  server-side: an unresolved destination still returns the index link. */
  konzinfo: (destination?: string) =>
    apiFetch<import("@shared/konzinfo").KonzinfoInfo>(
      "GET",
      destination
        ? `/api/honeymoon/konzinfo?destination=${encodeURIComponent(destination)}`
        : "/api/honeymoon/konzinfo",
    ),
  destinationPhoto: (destination: string) =>
    apiFetch<{ photo_url: string | null }>(
      "GET",
      `/api/honeymoon/destination-photo?destination=${encodeURIComponent(destination)}`,
    ),
  uploadCover: async (file: File): Promise<{ couple: Couple }> => {
    const form = new FormData();
    form.append("file", file);
    const token = getToken();
    const res = await fetch("/api/honeymoon/cover", {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json() as Promise<{ couple: Couple }>;
  },
  deleteCover: () => apiFetch<{ ok: true }>("DELETE", "/api/honeymoon/cover"),
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

/** Timeline -> Google Calendar push-sync. `status.configured` gates the whole
 *  UI; `connect()` returns the Google consent URL the page redirects to. */
export const googleCalendarApi = {
  status: () =>
    apiFetch<import("@shared/types").GoogleCalendarStatus>("GET", "/api/google-calendar/status"),
  connect: () => apiFetch<{ url: string }>("GET", "/api/google-calendar/connect"),
  sync: () =>
    apiFetch<import("@shared/types").GoogleCalendarStatus>("POST", "/api/google-calendar/sync"),
  disconnect: () =>
    apiFetch<import("@shared/types").GoogleCalendarStatus>(
      "POST",
      "/api/google-calendar/disconnect",
    ),
};

/** Vendor calendar -> Google Calendar push-sync. Same four endpoints and the
 *  same status shape as the couple flow, against the vendor aggregate; PRO-gated
 *  server-side because the availability calendar itself is. There is no
 *  `callback` here: both flows share one browser-only OAuth callback. */
export const vendorGoogleCalendarApi = {
  status: () =>
    apiFetch<import("@shared/types").GoogleCalendarStatus>(
      "GET",
      "/api/vendor/google-calendar/status",
    ),
  connect: () => apiFetch<{ url: string }>("GET", "/api/vendor/google-calendar/connect"),
  sync: () =>
    apiFetch<import("@shared/types").GoogleCalendarStatus>(
      "POST",
      "/api/vendor/google-calendar/sync",
    ),
  disconnect: () =>
    apiFetch<import("@shared/types").GoogleCalendarStatus>(
      "POST",
      "/api/vendor/google-calendar/disconnect",
    ),
};

/** Couple-curated wishlist / gift registry. Mirrors `scheduleApi`: list +
 *  CRUD with an optional optimistic-concurrency guard on update. No money
 *  moves in-app — `target_amount_minor` is informational only. Guests see a
 *  read-only deck on the confirmed-tier guest page; the soft "I'd like to
 *  help" tap lives on `weddingWebsiteApi.toggleWishlistInterest`. */
export const wishlistApi = {
  list: () => apiFetch<{ items: WishlistItem[] }>("GET", "/api/wishlist"),
  create: (body: UpsertWishlistItemInput) =>
    apiFetch<{ item: WishlistItem }>("POST", "/api/wishlist", body),
  /** Partial PATCH with optional optimistic-concurrency guard. Pass `ifMatch`
   *  with the row's last `updated_at` to make the server return 409 if a
   *  concurrent editor has touched the same item in the meantime. */
  update: (
    id: number,
    body: Partial<UpsertWishlistItemInput>,
    opts: { ifMatch?: number | string } = {},
  ) =>
    apiFetch<{ item: WishlistItem }>("PATCH", `/api/wishlist/${id}`, body, {
      headers: opts.ifMatch !== undefined ? { "If-Match": String(opts.ifMatch) } : undefined,
    }),
  remove: (id: number) => apiFetch<{ ok: true }>("DELETE", `/api/wishlist/${id}`),
  /** Resolve a product link's preview image (og:image) + title server-side so
   *  the editor can show a thumbnail before saving. Soft by contract: returns
   *  `{ image_url: null, title: null }` for an unreachable / blocked URL. */
  linkPreview: (url: string) =>
    apiFetch<WishlistLinkPreview>(
      "GET",
      `/api/wishlist/link-preview?url=${encodeURIComponent(url)}`,
    ),
};

/** Received-gifts ledger: the couple's private thank-you tracking grid. No
 *  guest-side surface. Same optimistic-concurrency contract as wishlistApi. */
export const receivedGiftApi = {
  list: () => apiFetch<{ items: ReceivedGift[] }>("GET", "/api/received-gifts"),
  create: (body: UpsertReceivedGiftInput) =>
    apiFetch<{ item: ReceivedGift }>("POST", "/api/received-gifts", body),
  update: (
    id: number,
    body: Partial<UpsertReceivedGiftInput>,
    opts: { ifMatch?: number | string } = {},
  ) =>
    apiFetch<{ item: ReceivedGift }>("PATCH", `/api/received-gifts/${id}`, body, {
      headers: opts.ifMatch !== undefined ? { "If-Match": String(opts.ifMatch) } : undefined,
    }),
  remove: (id: number) => apiFetch<{ ok: true }>("DELETE", `/api/received-gifts/${id}`),
};

/** Per-user couple membership + self-edit endpoints. */
export const userApi = {
  leaveCouple: () => apiFetch<{ ok: true }>("POST", "/api/users/me/leave-couple", {}),
  /** Patch the signed-in user's display name and/or persisted UI locale.
   *  Omitted fields stay untouched; an explicit `locale: null` clears the
   *  preference (client then falls back to navigator detection). */
  updateProfile: (body: { full_name?: string; locale?: "hu" | "en" | null }) =>
    apiFetch<{ user: import("@shared/types").User }>("PATCH", "/api/users/me", body),
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
  /** Ideas only — loose category tag for the ideas board. */
  idea_tag?: import("@shared/types").IdeaTag | null;
  position?: number;
}

export type PlanningItemPatch = Partial<Omit<PlanningItemCreate, "kind">> & {
  /** "Döntések" layer — move a prompt through its lifecycle. */
  decision_status?: import("@shared/types").DecisionStatus | null;
  /** "Döntések" layer — the recorded decision / supplier answer. */
  resolution?: string | null;
  /** Ideas only — triage state ("doing" | "maybe" | "skip"). */
  idea_status?: import("@shared/types").IdeaStatus | null;
};

/** Manual intake answers for the decision-prompt conditional dimensions. */
export type PlanningPromptTags = Partial<
  Record<import("@shared/planning_prompts").ConditionTag, "yes" | "no">
>;

export const planningApi = {
  list: () => apiFetch<{ items: import("@shared/types").PlanningItem[] }>("GET", "/api/planning"),
  create: (body: PlanningItemCreate) =>
    apiFetch<{ item: import("@shared/types").PlanningItem }>("POST", "/api/planning", body),
  update: (id: number, body: PlanningItemPatch) =>
    apiFetch<{ item: import("@shared/types").PlanningItem }>("PATCH", `/api/planning/${id}`, body),
  remove: (id: number) => apiFetch<{ ok: true }>("DELETE", `/api/planning/${id}`),
  /** Schedule-wizard bulk apply: set start/due dates (and an optional priority
   *  position) on many undated tasks at once. Returns the refreshed list. */
  applySchedule: (
    updates: {
      id: number;
      start_date: string | null;
      due_date: string | null;
      position?: number;
    }[],
  ) =>
    apiFetch<{ items: import("@shared/types").PlanningItem[]; applied: number }>(
      "POST",
      "/api/planning/schedule",
      { updates },
    ),
  /** Read the saved intake answers for the conditional decision-prompts. */
  getPromptProfile: () =>
    apiFetch<{ tags: PlanningPromptTags }>("GET", "/api/planning/prompts/profile"),
  /** Persist the intake answers. */
  savePromptProfile: (tags: PlanningPromptTags) =>
    apiFetch<{ tags: PlanningPromptTags }>("PUT", "/api/planning/prompts/profile", { tags }),
  /** Lazily materialise a theme group's prompts; returns the refreshed list. */
  generatePrompts: (group: import("@shared/planning_prompts").PromptGroup) =>
    apiFetch<{ items: import("@shared/types").PlanningItem[]; created: number }>(
      "POST",
      "/api/planning/prompts/generate",
      { group },
    ),
};

export const notificationApi = {
  /** Merged bell feed: live timeline items + stored events, with the unread
   *  count + the overdue / due-soon rollup the dashboard card headlines. */
  list: () =>
    apiFetch<import("@shared/notifications").NotificationFeed>("GET", "/api/notifications"),
  /** Stamp the read watermark ("I opened the bell"). Clears the badge only; it
   *  does NOT move unclicked items into history. Per-user. */
  markSeen: () => apiFetch<{ seen_at: number | null }>("POST", "/api/notifications/seen", {}),
  /** Mark ONE feed item read ("I clicked it") so it moves to history. */
  markRead: (id: string) => apiFetch<{ ok: true }>("POST", "/api/notifications/read", { id }),
  /** Dismiss the one-time feedback survey prompt — sets survey_prompted_at
   *  so the virtual bell item never reappears for this user. */
  surveyDismiss: () => apiFetch<{ ok: true }>("POST", "/api/notifications/survey/dismiss", {}),
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
  /** Persist the couple's manual household order (drag-to-reorder on
   *  /app/guests). `orderedIds` is the desired top-to-bottom sequence of
   *  non-host households; the host household is pinned server-side. Returns
   *  the freshly ordered list so the client can reconcile. */
  reorder: (orderedIds: number[]) =>
    apiFetch<{ households: Household[] }>("PATCH", "/api/households/reorder", {
      ordered_ids: orderedIds,
    }),
  regenerateCode: (id: number) =>
    apiFetch<{ household: Household }>("POST", `/api/households/${id}/regenerate-code`, {}),
  /** Rotate the household's share code (Phase 3 guest-page share UI). Same
   *  effect as `regenerateCode` but rate-limited per couple and returns just
   *  `{ household: { id, code } }` — the full Household view isn't needed
   *  on the share row; only the fresh code is. */
  rotateCode: (id: number) =>
    apiFetch<{ household: { id: number; code: string } }>(
      "PATCH",
      `/api/households/${id}/rotate-code`,
      {},
    ),
  /** Mass invite send. With `household_ids` omitted the backend targets every
   *  eligible household; we pass the explicit eligible set computed on the
   *  client so the confirm dialog and the actual send agree. The backend is
   *  authoritative: it re-checks `invited_at` so a household is never invited
   *  twice even if two planners click at once. */
  inviteBatch: (body: { household_ids?: number[]; resend?: boolean }) =>
    apiFetch<{
      sent: number;
      failed: number;
      skipped_already_invited: number;
      skipped_no_email: number;
      results: Array<{
        household_id: number;
        label: string;
        status: "sent" | "failed" | "skipped_already_invited" | "skipped_no_email";
        email: string | null;
      }>;
    }>("POST", "/api/households/invite-batch", body),
};

/** Guest communication center (`/app/invites`): broadcasts (invite / major
 *  update / pre-wedding info) plus the envelope-tip per-head settings. */
export const guestMessageApi = {
  list: () => apiFetch<{ messages: GuestMessage[] }>("GET", "/api/guest-messages"),
  /** Create a broadcast. Omit `scheduled_at` (or pass a past time) to send
   *  immediately; pass a future epoch-ms to schedule it for the email worker. */
  send: (body: {
    template: GuestMessageTemplate;
    audience: GuestMessageAudience;
    subject?: string | null;
    body?: string | null;
    include_envelope_tip?: boolean;
    scheduled_at?: number | null;
  }) => apiFetch<{ message: GuestMessage }>("POST", "/api/guest-messages", body),
  /** Cancel a not-yet-sent (scheduled) broadcast. */
  cancel: (id: number) => apiFetch<{ ok: true }>("DELETE", `/api/guest-messages/${id}`),
  getEnvelopeTip: () => apiFetch<EnvelopeTip>("GET", "/api/guest-messages/envelope-tip"),
  updateEnvelopeTip: (body: { enabled?: boolean; override?: number | null }) =>
    apiFetch<EnvelopeTip>("PATCH", "/api/guest-messages/envelope-tip", body),
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

/** Invoice / receipt documents attached to a budget row (the bill icon in the
 *  PAID column). `scope` is 'cat:<category>' for an aggregated category row or
 *  'line:<id>' for a custom line. PDFs + images, ≤8 MB each. */
export const budgetDocApi = {
  list: () => apiFetch<{ documents: BudgetDocument[] }>("GET", "/api/budget/documents"),
  /** Multipart upload — JSON-shaped `apiFetch` doesn't speak FormData, so we
   *  hit fetch directly with the same auth header (mirrors moodboard upload). */
  upload: async (scope: string, file: File): Promise<{ document: BudgetDocument }> => {
    const form = new FormData();
    form.append("scope", scope);
    form.append("file", file);
    const token = getToken();
    const res = await fetch("/api/budget/documents", {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    const text = await res.text();
    if (!res.ok) {
      let parsed: { code?: string; message?: string } | null = null;
      try {
        parsed = text ? (JSON.parse(text) as { code?: string; message?: string }) : null;
      } catch {
        parsed = null;
      }
      throw new ApiError(
        res.status,
        res.status >= 500 ? "server_error" : "client_error",
        parsed?.message ?? text ?? "Upload failed",
        parsed,
      );
    }
    return JSON.parse(text) as { document: BudgetDocument };
  },
  remove: (id: number) => apiFetch<{ ok: true }>("DELETE", `/api/budget/documents/${id}`),
  /** Auth-protected blob fetch for a private invoice/receipt. These are no
   *  longer served by the public `/uploads/*` URL — the caller opens the blob in
   *  a new tab (mirrors `fetchSavedExportBlob`). */
  fetchBlob: async (id: number): Promise<Blob> => {
    const token = getToken();
    const res = await fetch(`/api/budget/documents/${id}/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) throw new Error(`Document fetch failed: ${res.status}`);
    return res.blob();
  },
};

/** Timestamped payment ledger behind the PAID column. Each row records one
 *  payment ("20% paid today"), anchored by the same scope as the documents /
 *  paid cell ('cat:<category>' | 'line:<id>'). The cumulative paid amount stays
 *  on the budget line — these are the additive history. */
export const budgetPaymentApi = {
  list: () => apiFetch<{ payments: BudgetPayment[] }>("GET", "/api/budget/payments"),
  create: (body: { scope: string; amount_huf: number; paid_at?: number; note?: string | null }) =>
    apiFetch<{ payment: BudgetPayment }>("POST", "/api/budget/payments", body),
  update: (id: number, body: { amount_huf?: number; paid_at?: number; note?: string | null }) =>
    apiFetch<{ payment: BudgetPayment }>("PATCH", `/api/budget/payments/${id}`, body),
  remove: (id: number) => apiFetch<{ ok: true }>("DELETE", `/api/budget/payments/${id}`),
  /** Attach a PDF invoice/receipt to one payment. Multipart (apiFetch is
   *  JSON-only), same auth header. Returns the updated payment. */
  uploadPdf: async (id: number, file: File): Promise<{ payment: BudgetPayment }> => {
    const form = new FormData();
    form.append("file", file);
    const token = getToken();
    const res = await fetch(`/api/budget/payments/${id}/pdf`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    const text = await res.text();
    if (!res.ok) {
      let parsed: { code?: string; message?: string } | null = null;
      try {
        parsed = text ? (JSON.parse(text) as { code?: string; message?: string }) : null;
      } catch {
        parsed = null;
      }
      throw new ApiError(
        res.status,
        res.status >= 500 ? "server_error" : "client_error",
        parsed?.message ?? text ?? "Upload failed",
        parsed,
      );
    }
    return JSON.parse(text) as { payment: BudgetPayment };
  },
  removePdf: (id: number) =>
    apiFetch<{ payment: BudgetPayment }>("DELETE", `/api/budget/payments/${id}/pdf`),
  /** Auth-protected blob fetch for the private PDF — the caller opens it in a
   *  new tab (mirrors budgetDocApi.fetchBlob). */
  fetchPdfBlob: async (id: number): Promise<Blob> => {
    const token = getToken();
    const res = await fetch(`/api/budget/payments/${id}/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) throw new Error(`PDF fetch failed: ${res.status}`);
    return res.blob();
  },
};

export const incomeApi = {
  list: () => apiFetch<{ income: CoupleIncome[] }>("GET", "/api/income"),
  create: (body: CreateCoupleIncomeInput) =>
    apiFetch<{ income: CoupleIncome }>("POST", "/api/income", body),
  update: (id: number, body: UpdateCoupleIncomeInput) =>
    apiFetch<{ income: CoupleIncome }>("PATCH", `/api/income/${id}`, body),
  remove: (id: number) => apiFetch<{ ok: true }>("DELETE", `/api/income/${id}`),
};

export const rsvpApi = {
  /** New airport-style check-in: couple slug + 8-character household code. */
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

export const weddingWebsiteApi = {
  /** Public — couple-branded landing page at /w/:slug. Returns the
   *  `public` tier shape (anonymous visitor). 404 when the slug doesn't
   *  match an active couple OR the couple hasn't opted in via
   *  `is_public = 1`. The legacy `r.wedding` shape is preserved for
   *  callers that don't care about tier/household. */
  get: (slug: string) =>
    apiFetch<PublicWeddingResponse>("GET", `/api/public/wedding/${encodeURIComponent(slug)}`),
  /** Public — code-bearing variant served at /w/:slug/:code. Returns
   *  `invited` (valid code, nobody RSVP'd yes yet) or `confirmed` (≥1
   *  yes) tier. Works even on private (`is_public = 0`) couples —
   *  personal codes are the credential. */
  getWithCode: (slug: string, code: string) =>
    apiFetch<PublicWeddingResponse>(
      "GET",
      `/api/public/wedding/${encodeURIComponent(slug)}/${encodeURIComponent(code)}`,
    ),
  /** Public, code-gated — toggle the household's soft "I'd like to help"
   *  interest on a `group_gift` wishlist item. The personal household code is
   *  the credential; the server resolves it to the household, flips the
   *  interest row, and returns the fresh aggregate. 403 unless the slug+code
   *  resolves to the `confirmed` tier (>=1 RSVP yes) and the item is a
   *  group gift. `notificationEmail` is stored server-side only — never
   *  returned in any response. */
  toggleWishlistInterest: (
    slug: string,
    code: string,
    itemId: number,
    pledgedAmountMinor?: number | null,
    notificationEmail?: string,
  ) => {
    const body: Record<string, unknown> =
      pledgedAmountMinor === undefined ? {} : { pledged_amount_minor: pledgedAmountMinor };
    if (notificationEmail) body.notification_email = notificationEmail;
    return apiFetch<WishlistInterestToggleResult>(
      "POST",
      `/api/public/wedding/${encodeURIComponent(slug)}/${encodeURIComponent(
        code,
      )}/wishlist/${itemId}/interest`,
      body,
    );
  },
  /** Public, code-gated, pledge-gated — retrieve the group-gift contributor
   *  list for an item the requesting household has already pledged on.
   *  Returns `null` when the household has not pledged (server returns 403).
   *  No email addresses are included in the response. */
  getContributors: async (
    coupleSlug: string,
    householdCode: string,
    itemId: number,
  ): Promise<WishlistContributorsResult | null> => {
    const r = await fetch(
      `/api/public/wedding/${encodeURIComponent(coupleSlug)}/${encodeURIComponent(householdCode)}/wishlist/${itemId}/contributors`,
    );
    if (r.status === 403) return null;
    if (!r.ok) throw new Error("contributors fetch failed");
    return r.json() as Promise<WishlistContributorsResult>;
  },
};

export interface SeatingPlan {
  tables: SeatingTable[];
  assignments: SeatAssignment[];
  conflicts: SeatingConflict[];
}

/** Create/update responses carry the persisted row plus an optional clamp
 *  diagnostic: when the requested seat count exceeded what the table's
 *  footprint fits at the 80 cm chair pitch, the server silently shrinks it
 *  and reports the original ask so the UI can explain instead of no-op. */
export interface SeatingTableEnvelope {
  table: SeatingTable;
  seats_clamped?: boolean;
  seats_requested?: number;
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
  }) => apiFetch<SeatingTableEnvelope>("POST", "/api/seating/tables", body),
  /** Partial PATCH with optional `If-Match` for optimistic concurrency.
   *  Pass the row's `updated_at` (or stringified equivalent) to get a 409
   *  when a second editor has touched the same table since the last load. */
  updateTable: (
    id: number,
    body: Partial<SeatingTable>,
    opts: { ifMatch?: number | string } = {},
  ) =>
    apiFetch<SeatingTableEnvelope>("PATCH", `/api/seating/tables/${id}`, body, {
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
  /** Assign a guest to an accommodation (or pass null to unassign). Clears any
   *  specific-room placement — use `accommodationRoomApi.assign` for rooms. */
  assign: (body: { guest_id: number; accommodation_id: number | null }) =>
    apiFetch<{ ok: true }>("POST", "/api/accommodations/assign", body),
};

/** Logistics: rooms within an accommodation. Optional subdivision — once an
 *  accommodation has rooms, guests are assigned per room with a per-room cap. */
export const accommodationRoomApi = {
  list: () => apiFetch<{ rooms: AccommodationRoom[] }>("GET", "/api/accommodation-rooms"),
  create: (body: UpsertAccommodationRoomInput) =>
    apiFetch<{ room: AccommodationRoom }>("POST", "/api/accommodation-rooms", body),
  update: (id: number, body: Partial<UpsertAccommodationRoomInput>) =>
    apiFetch<{ room: AccommodationRoom }>("PATCH", `/api/accommodation-rooms/${id}`, body),
  remove: (id: number) => apiFetch<{ ok: true }>("DELETE", `/api/accommodation-rooms/${id}`),
  /** Assign a guest into a specific room (or pass null to unassign). */
  assign: (body: { guest_id: number; room_id: number | null }) =>
    apiFetch<{ ok: true }>("POST", "/api/accommodation-rooms/assign", body),
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
  /** `country` scopes the curated catalogue: an ISO alpha-2 code, or "all" to
   *  drop the couple-derived country scope. Omitted → backend defaults to the
   *  couple's onboarding country. The response also lists every country the
   *  catalogue covers (with counts) so the UI can build its picker. */
  list: (category?: SupplierCategory, country?: string) => {
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (country) params.set("country", country);
    const qs = params.toString();
    return apiFetch<{ suppliers: DirectorySupplier[]; countries: SupplierCountryCount[] }>(
      "GET",
      qs ? `/api/suppliers?${qs}` : "/api/suppliers",
    );
  },
  submitCommunity: (body: SubmitCommunitySupplierInput) =>
    apiFetch<{ supplier: DirectorySupplier }>("POST", "/api/suppliers/community", body),
  /** Live "is this supplier already on Weddly?" lookup for the recommend form.
   *  Public — matches the full directory by name, returns up to 6 matches. */
  nameCheck: (name: string) =>
    apiFetch<SupplierNameCheckResponse>(
      "GET",
      `/api/suppliers/name-check?name=${encodeURIComponent(name)}`,
    ),
  /** Best-effort resolver: paste a Google Maps URL, get back any of:
   *  name, address, city, lat/lng, website, phone. Each field may be null.
   *  Pass `visitorToken` (public /vendors register flow) to auth as a verified
   *  visitor via X-Visitor-Token instead of a session bearer. */
  resolveMapsUrl: (url: string, visitorToken?: string) =>
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
    }>(
      "POST",
      "/api/suppliers/resolve-maps-url",
      { url },
      {
        headers: visitorToken ? { "X-Visitor-Token": visitorToken } : {},
      },
    ),
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
  /** Fetch the detail-page payload (reviews summary, comments count for admin,
   *  next available date for admin, bookable flag). Admin-only on the route
   *  in v1; will downgrade to requireAuth in Phase 3. */
  detail: (supplierId: string) =>
    apiFetch<SupplierDetail>("GET", `/api/suppliers/${encodeURIComponent(supplierId)}`),
  /** Public, unauthenticated vendor-page payload (detail + published reviews +
   *  public Q&A + busy calendar) for the shareable `/vendors/:id` page. Works
   *  with or without a session token. */
  publicDetail: (supplierId: string) =>
    apiFetch<PublicVendorPageData>("GET", `/api/public/vendors/${encodeURIComponent(supplierId)}`),
  /** Public "browse teaser" — a photos-only directory sample grouped by
   *  category (max 6 each) for the unauthenticated `/vendors/browse` page. */
  /** `country` scopes the sample to one ISO alpha-2 code (the teaser's chip
   *  row); `city` to one town (where a city pick from the public typeahead
   *  lands). Both omitted means every country, ordered with the visitor's
   *  own first. */
  publicShowcase: (country?: string | null, city?: string | null) => {
    const qs = new URLSearchParams();
    if (country) qs.set("country", country);
    if (city) qs.set("city", city);
    const suffix = qs.size > 0 ? `?${qs}` : "";
    return apiFetch<PublicVendorShowcase>("GET", `/api/public/vendor-showcase${suffix}`);
  },
  /** Public typeahead for the landing-page directory search: vendor + city
   *  hits, plus the category census the client matches in its own language. */
  publicSearch: (q: string) =>
    apiFetch<PublicVendorSearchResult>(
      "GET",
      `/api/public/vendor-search?q=${encodeURIComponent(q)}`,
    ),
};

export const reviewApi = {
  list: (supplierId: string, opts?: { cursor?: string | null; limit?: number }) => {
    const qs = new URLSearchParams();
    if (opts?.cursor) qs.set("cursor", opts.cursor);
    if (opts?.limit) qs.set("limit", String(opts.limit));
    const tail = qs.toString() ? `?${qs.toString()}` : "";
    return apiFetch<ReviewListResponse>(
      "GET",
      `/api/suppliers/${encodeURIComponent(supplierId)}/reviews${tail}`,
    );
  },
  create: (supplierId: string, body: CreateReviewBody) =>
    apiFetch<SupplierReview>(
      "POST",
      `/api/suppliers/${encodeURIComponent(supplierId)}/reviews`,
      body,
    ),
  update: (reviewId: number, body: Partial<CreateReviewBody>) =>
    apiFetch<SupplierReview>("PATCH", `/api/reviews/${reviewId}`, body),
  remove: (reviewId: number) => apiFetch<{ ok: true }>("DELETE", `/api/reviews/${reviewId}`),
};

// Verified-visitor device token — an email-verified party with NO Weddly login.
// Stored under a DISTINCT key from the session token (weddly.token) so the app
// never mistakes a visitor for a signed-in user.
const VISITOR_TOKEN_KEY = "weddly.visitor";

export function getVisitorToken(): string | null {
  try {
    return localStorage.getItem(VISITOR_TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setVisitorToken(token: string | null) {
  try {
    if (token) localStorage.setItem(VISITOR_TOKEN_KEY, token);
    else localStorage.removeItem(VISITOR_TOKEN_KEY);
  } catch {
    // localStorage blocked (embeds / hardened privacy) — fail soft.
  }
}

/** Actions for an email-verified visitor with no account. googleVerify mints
 *  (and stores) the device token; createReview replays it on X-Visitor-Token. */
export const visitorApi = {
  googleVerify: async (credential: string, locale?: "hu" | "en"): Promise<VisitorSession> => {
    const session = await apiFetch<VisitorSession>("POST", "/api/visitors/verify/google", {
      credential,
      locale,
    });
    setVisitorToken(session.token);
    return session;
  },
  createReview: (supplierId: string, body: CreateReviewBody, visitorToken?: string) => {
    const token = visitorToken ?? getVisitorToken();
    return apiFetch<SupplierReview>(
      "POST",
      `/api/public/suppliers/${encodeURIComponent(supplierId)}/reviews`,
      body,
      { headers: token ? { "X-Visitor-Token": token } : {} },
    );
  },
  /** Suggest/register a new vendor as a verified visitor (no account). Same
   *  public community endpoint the logged-in couple uses, but authed by the
   *  device token on X-Visitor-Token instead of a session bearer. */
  submitSupplier: (body: SubmitCommunitySupplierInput, visitorToken?: string) => {
    const token = visitorToken ?? getVisitorToken();
    return apiFetch<{ supplier: DirectorySupplier }>("POST", "/api/suppliers/community", body, {
      headers: token ? { "X-Visitor-Token": token } : {},
    });
  },
};

/** Admin review moderation — the flagged (low-rating open) review queue. */
export const adminReviewApi = {
  listFlagged: (opts?: { cursor?: string | null; limit?: number }) => {
    const qs = new URLSearchParams();
    if (opts?.cursor) qs.set("cursor", opts.cursor);
    if (opts?.limit) qs.set("limit", String(opts.limit));
    const tail = qs.toString() ? `?${qs.toString()}` : "";
    return apiFetch<AdminFlaggedReviewsResponse>("GET", `/api/admin/reviews/flagged${tail}`);
  },
  unflag: (reviewId: number) =>
    apiFetch<{ ok: true }>("POST", `/api/admin/reviews/${reviewId}/unflag`),
  remove: (reviewId: number) => apiFetch<{ ok: true }>("DELETE", `/api/reviews/${reviewId}`),
};

export const supplierCommentApi = {
  list: (supplierId: string, opts?: { cursor?: string | null; limit?: number }) => {
    const qs = new URLSearchParams();
    if (opts?.cursor) qs.set("cursor", opts.cursor);
    if (opts?.limit) qs.set("limit", String(opts.limit));
    const tail = qs.toString() ? `?${qs.toString()}` : "";
    return apiFetch<CommentListResponse>(
      "GET",
      `/api/suppliers/${encodeURIComponent(supplierId)}/comments${tail}`,
    );
  },
  create: (supplierId: string, body: CreateCommentBody) =>
    apiFetch<SupplierComment>(
      "POST",
      `/api/suppliers/${encodeURIComponent(supplierId)}/comments`,
      body,
    ),
  remove: (commentId: number) => apiFetch<{ ok: true }>("DELETE", `/api/comments/${commentId}`),
};

export const supplierBookingApi = {
  availability: (supplierId: string) =>
    apiFetch<SupplierAvailability>(
      "GET",
      `/api/suppliers/${encodeURIComponent(supplierId)}/availability`,
    ),
  list: (supplierId: string) =>
    apiFetch<{ items: SupplierBooking[] }>(
      "GET",
      `/api/suppliers/${encodeURIComponent(supplierId)}/bookings`,
    ),
  create: (supplierId: string, body: CreateBookingBody & { couple_id: number }) =>
    apiFetch<SupplierBooking>(
      "POST",
      `/api/suppliers/${encodeURIComponent(supplierId)}/bookings`,
      body,
    ),
  updateStatus: (bookingId: number, status: SupplierBooking["status"]) =>
    apiFetch<SupplierBooking>("PATCH", `/api/bookings/${bookingId}`, { status }),
  /** Returns the .ics URL. The actual download is handled by the browser via
   *  a plain <a download> — apiFetch is JSON-only. */
  icsUrl: (bookingId: number) => `/api/bookings/${bookingId}/ics`,
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
  /** Payment schedule. Each call returns the full updated supplier (with its
   *  recomputed `paid` flag + installments) so the caller refreshes in one shot. */
  addInstallment: (id: string, body: CreateInstallmentInput) =>
    apiFetch<{ supplier: CoupleSupplier }>(
      "POST",
      `/api/couple-suppliers/${encodeURIComponent(id)}/installments`,
      body,
    ),
  updateInstallment: (id: string, installmentId: number, body: UpdateInstallmentInput) =>
    apiFetch<{ supplier: CoupleSupplier }>(
      "PATCH",
      `/api/couple-suppliers/${encodeURIComponent(id)}/installments/${installmentId}`,
      body,
    ),
  removeInstallment: (id: string, installmentId: number) =>
    apiFetch<{ supplier: CoupleSupplier }>(
      "DELETE",
      `/api/couple-suppliers/${encodeURIComponent(id)}/installments/${installmentId}`,
    ),
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

export const savedApi = {
  list: () => apiFetch<{ saved: SavedSupplier[] }>("GET", "/api/saved-suppliers"),
  add: (supplier_id: string) =>
    apiFetch<{ ok: true }>("PUT", `/api/saved-suppliers/${encodeURIComponent(supplier_id)}`),
  remove: (supplier_id: string) =>
    apiFetch<{ ok: true }>("DELETE", `/api/saved-suppliers/${encodeURIComponent(supplier_id)}`),
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
  /** Resend the account_flagged email for the user's current active flag
   *  without touching the deadline. Use when the original email bounced
   *  or went to spam. 404 when no active flag exists. */
  resendFlagEmail: (id: number) =>
    apiFetch<{ ok: true }>("POST", `/api/admin/users/${id}/resend-flag-email`, {}),
  /** Last 30 email_log rows for this user — kind, status (sent/failed),
   *  to_email, error. Lets admin verify delivery of account_flagged etc. */
  listEmails: (id: number) =>
    apiFetch<{ emails: AdminEmailLogEntry[] }>("GET", `/api/admin/users/${id}/emails`),
  /** Mark / unmark a user as a beta tester. Non-destructive grouping label
   *  (no email, no countdown) that buckets the account + its workspace into
   *  the admin "Beta testers" section. Returns the updated admin view so the
   *  row re-renders without a refetch; callers also refetch couples since
   *  the workspace may move between groups. */
  setBetaTester: (id: number, beta: boolean) =>
    apiFetch<{ user: AdminUserView | null }>("POST", `/api/admin/users/${id}/beta`, { beta }),
  /** "Channel over" a mis-routed account (e.g. a supplier who signed up as a
   *  couple) to a real vendor: flips role='vendor', creates the vendor account
   *  + a live listing seeded with the category, and grants billing.
   *  Non-destructive (couple data preserved). The user moves off the
   *  Felhasználók list onto Szolgáltatók, so the caller refetches. */
  convertToVendor: (
    id: number,
    body: { business_name?: string; category: string; custom_category?: string },
  ) =>
    apiFetch<{ ok: true; vendor_account_id: number }>(
      "POST",
      `/api/admin/users/${id}/convert-to-vendor`,
      body,
    ),
  /** Manually nudge a solo workspace owner to invite their partner. One
   *  send per workspace — the server stamps `couples.invite_partner_reminded_at`
   *  and returns 409 with `code: "already_reminded"` on a second attempt.
   *  Returns the timestamp so the UI can flip the icon to its sage Mail+Check
   *  "sent" state without a re-fetch. */
  remindInvitePartner: (coupleId: number) =>
    apiFetch<{ ok: true; reminded_at: number }>(
      "POST",
      `/api/admin/couples/${coupleId}/remind-invite-partner`,
      {},
    ),
  /** Comp a couple 18 months free ("free badge"). Returns the updated row. */
  grantFree: (coupleId: number) =>
    apiFetch<{ couple: AdminCoupleView }>("POST", `/api/admin/couples/${coupleId}/grant-free`, {}),
  /** Remove a previously-granted free badge (couple goes read-only). */
  revokeFree: (coupleId: number) =>
    apiFetch<{ couple: AdminCoupleView }>("POST", `/api/admin/couples/${coupleId}/revoke-free`, {}),
  /** Unread-style counts for the admin nav rail. AppShell polls this
   *  every ~30s while the admin is signed in and renders a small red
   *  badge next to each section with count > 0. */
  sidebarBadges: () => apiFetch<AdminSidebarBadges>("GET", "/api/admin/sidebar-badges"),
  /** Instagram-style "I looked at this" ping — stamps `admin_section_seen.seen_at`
   *  for this admin+section so the next badge poll counts only rows authored
   *  AFTER the visit. AppShell fires this on navigation into the matching
   *  /app/admin/{section} path. */
  markSectionSeen: (
    section:
      | "suppliers"
      | "users"
      | "planners"
      | "vendors"
      | "vendor_waitlist"
      | "planner_waitlist"
      | "feedback",
  ) =>
    apiFetch<{ ok: true; section: string; seen_at: number }>(
      "POST",
      "/api/admin/sidebar-badges/seen",
      { section },
    ),
};

/** Admin vendor management (KEZELÉS → Szolgáltatók). Lists activated vendor
 *  accounts (`active`) plus accepted-but-not-yet-activated onboarding rows
 *  (`pending`). Mutations act on the underlying user (suspend/delete) or the
 *  account (edit); resend re-mints the activation link for a pending row. */
export const adminVendorMgmtApi = {
  list: () =>
    apiFetch<{ active: AdminVendorView[]; pending: AdminVendorView[] }>(
      "GET",
      "/api/admin/vendors",
    ),
  /** Admin-initiated vendor registration: mints a pending onboarding and emails
   *  the activation link (the vendor sets their own password). Lands in the
   *  "Aktiválásra vár" list until they activate. */
  register: (body: { email: string; business_name: string; category: string }) =>
    apiFetch<{ ok: true; onboarding_id: number }>("POST", "/api/admin/vendors/register", body),
  suspend: (id: number) =>
    apiFetch<{ ok: true; status: string }>("POST", `/api/admin/vendors/${id}/suspend`, {}),
  reactivate: (id: number) =>
    apiFetch<{ ok: true; status: string }>("POST", `/api/admin/vendors/${id}/reactivate`, {}),
  /** Send the "your listing is still incomplete" reminder to this vendor on
   *  demand. 400s when the listing is already complete. */
  remindIncomplete: (id: number) =>
    apiFetch<{ ok: true; missing: Record<string, boolean> }>(
      "POST",
      `/api/admin/vendors/${id}/remind-incomplete`,
      {},
    ),
  /** Reroute a mis-routed vendor to the planner side: same login, listing
   *  released back to unclaimed, vendor account (and its availability / tasks /
   *  payments) removed. The counts come back so the UI can report what moved. */
  convertToPlanner: (id: number) =>
    apiFetch<{
      ok: true;
      user_id: number;
      listings_released: number;
      bookings_unlinked: number;
      vendor_rows_deleted: number;
      seeded_from_waitlist: boolean;
    }>("POST", `/api/admin/vendors/${id}/convert-to-planner`, {}),
  update: (
    id: number,
    body: {
      display_name?: string;
      company_name?: string | null;
      contact_email?: string | null;
      contact_phone?: string | null;
      vat_number?: string | null;
      /** Supplier category — written to the vendor's listing, not the account. */
      category?: string;
    },
  ) => apiFetch<{ ok: true }>("PATCH", `/api/admin/vendors/${id}`, body),
  remove: (id: number) => apiFetch<{ ok: true }>("DELETE", `/api/admin/vendors/${id}`),
  /** Re-send the activation link for an accepted-but-pending vendor (the id is
   *  the vendor_onboarding row id, not a vendor_accounts id). */
  resendActivation: (onboardingId: number) =>
    apiFetch<{ ok: true }>("POST", `/api/admin/vendors/onboarding/${onboardingId}/resend`, {}),
  /** Edit a pending onboarding's category before the vendor activates (id is the
   *  vendor_onboarding row id). */
  updateOnboarding: (onboardingId: number, body: { category: string }) =>
    apiFetch<{ ok: true }>("PATCH", `/api/admin/vendors/onboarding/${onboardingId}`, body),
};

/** Admin planner management (KEZELÉS → Szervezők). A planner is a user with
 *  user_type='planner'; ids here are user ids. */
export const adminPlannerMgmtApi = {
  list: () => apiFetch<{ planners: AdminPlannerView[] }>("GET", "/api/admin/planners"),
  suspend: (id: number) =>
    apiFetch<{ ok: true; status: string }>("POST", `/api/admin/planners/${id}/suspend`, {}),
  reactivate: (id: number) =>
    apiFetch<{ ok: true; status: string }>("POST", `/api/admin/planners/${id}/reactivate`, {}),
  verify: (id: number) =>
    apiFetch<{ ok: true; verified: boolean }>("POST", `/api/admin/planners/${id}/verify`, {}),
  unverify: (id: number) =>
    apiFetch<{ ok: true; verified: boolean }>("POST", `/api/admin/planners/${id}/unverify`, {}),
  /** Email the planner a "finish your profile" reminder (manual, on top of the
   *  one automatic post-signup nudge). Returns the missing-field breakdown. */
  remindProfile: (id: number) =>
    apiFetch<{
      ok: true;
      missing: { businessName: boolean; city: boolean; bio: boolean; styles: boolean };
    }>("POST", `/api/admin/planners/${id}/remind-profile`, {}),
  setPlan: (id: number, plan: PlannerPlan) =>
    apiFetch<{ ok: true; planner_plan: PlannerPlan }>("PATCH", `/api/admin/planners/${id}`, {
      planner_plan: plan,
    }),
  remove: (id: number) => apiFetch<{ ok: true }>("DELETE", `/api/admin/planners/${id}`),
  provision: (body: AdminProvisionPlannerInput) =>
    apiFetch<{ ok: true; user_id: number }>("POST", "/api/admin/planners/provision", body),
  /** "A user suggested these planners": paste a list, get back one row per
   *  parsed address. `dry_run` previews the parse without creating an account
   *  or sending anything; `locale` omitted lets each row pick its own. */
  inviteBatch: (body: { text: string; dry_run: boolean; locale?: "hu" | "en" }) =>
    apiFetch<PlannerInviteBatchResult>("POST", "/api/admin/planners/invite-batch", body),
  resendActivation: (id: number) =>
    apiFetch<{ ok: true }>("POST", `/api/admin/planners/${id}/resend-activation`, {}),
  /** Approve an accepted waitlist applicant and open their planner account
   *  (keyed on planner_waitlist.id). No account yet -> provisions a dormant
   *  planner + emails an activation link into a pre-filled onboarding
   *  (`provisioned: true`). Existing non-planner account -> converts + seeds it
   *  (`converted: true`) and emails a sign-in link. Already a planner -> re-seed
   *  + sign-in link. */
  sendInvite: (waitlistId: number) =>
    apiFetch<{
      ok: true;
      provisioned?: boolean;
      converted?: boolean;
      has_account: boolean;
    }>("POST", `/api/admin/planners/pending/${waitlistId}/send-invite`, {}),
};

/** Admin-provisioned planner activation landing (public, token-gated). The
 *  `complete` call returns a fresh AuthSession the caller must install via
 *  useAuth().setSession, same contract as the vendor claim flow. */
export const plannerActivationApi = {
  view: (token: string) =>
    apiFetch<PlannerActivationView>("GET", `/api/planner/activation/${encodeURIComponent(token)}`),
  complete: (body: {
    token: string;
    password: string;
    privacy_version: string;
    terms_version: string;
    locale?: string;
  }) => apiFetch<AuthSession>("POST", "/api/planner/activation/complete", body),
};

/** Admin console for the claim-invite campaign. `targets` is the look-before-
 *  you-leap view (exactly who the next batch would write to); `sendBatch` is a
 *  small supervised round, everything beyond that is paced by the worker. */
export const adminVendorCampaignApi = {
  list: () => apiFetch<{ campaigns: VendorCampaign[] }>("GET", "/api/admin/vendor-campaigns"),
  create: (body: CreateVendorCampaignInput) =>
    apiFetch<{ campaign: VendorCampaign }>("POST", "/api/admin/vendor-campaigns", body),
  detail: (id: number) =>
    apiFetch<VendorCampaignDetail>("GET", `/api/admin/vendor-campaigns/${id}`),
  update: (id: number, body: UpdateVendorCampaignInput) =>
    apiFetch<{ campaign: VendorCampaign }>("PATCH", `/api/admin/vendor-campaigns/${id}`, body),
  targets: (id: number) =>
    apiFetch<{ targets: VendorCampaignTarget[]; stats: VendorCampaignStats }>(
      "GET",
      `/api/admin/vendor-campaigns/${id}/targets`,
    ),
  /** Reachable audience per country, as a brand-new campaign would see it.
   *  Feeds the create form's country picker + its "how many, how long" hint. */
  segments: () => apiFetch<VendorCampaignSegments>("GET", "/api/admin/vendor-campaigns/segments"),
  sends: (id: number) =>
    apiFetch<{ sends: VendorCampaignSend[] }>("GET", `/api/admin/vendor-campaigns/${id}/sends`),
  sendBatch: (id: number, limit: number) =>
    apiFetch<{ sent: number }>("POST", `/api/admin/vendor-campaigns/${id}/send-batch`, { limit }),
  runReminders: () =>
    apiFetch<{ sent: number }>("POST", "/api/admin/vendor-campaigns/reminders", {}),
  optOut: (email: string) =>
    apiFetch<{ ok: true; created: boolean }>("POST", "/api/admin/vendor-campaigns/optout", {
      email,
    }),
};

/** Admin console for the review-invite campaign — the mirror of the claim
 *  campaign, but writing to CLAIMED vendors to collect reviews. Same
 *  preview-before-you-send shape. */
export const adminVendorReviewCampaignApi = {
  list: () =>
    apiFetch<{ campaigns: VendorReviewCampaign[] }>("GET", "/api/admin/vendor-review-campaigns"),
  create: (body: CreateVendorReviewCampaignInput) =>
    apiFetch<{ campaign: VendorReviewCampaign }>(
      "POST",
      "/api/admin/vendor-review-campaigns",
      body,
    ),
  detail: (id: number) =>
    apiFetch<VendorReviewCampaignDetail>("GET", `/api/admin/vendor-review-campaigns/${id}`),
  update: (id: number, body: UpdateVendorReviewCampaignInput) =>
    apiFetch<{ campaign: VendorReviewCampaign }>(
      "PATCH",
      `/api/admin/vendor-review-campaigns/${id}`,
      body,
    ),
  targets: (id: number) =>
    apiFetch<{ targets: VendorReviewCampaignTarget[]; stats: VendorReviewCampaignStats }>(
      "GET",
      `/api/admin/vendor-review-campaigns/${id}/targets`,
    ),
  segments: () =>
    apiFetch<VendorReviewCampaignSegments>("GET", "/api/admin/vendor-review-campaigns/segments"),
  sends: (id: number) =>
    apiFetch<{ sends: VendorReviewCampaignSend[] }>(
      "GET",
      `/api/admin/vendor-review-campaigns/${id}/sends`,
    ),
  sendBatch: (id: number, limit: number) =>
    apiFetch<{ sent: number }>("POST", `/api/admin/vendor-review-campaigns/${id}/send-batch`, {
      limit,
    }),
  runReminders: () =>
    apiFetch<{ sent: number }>("POST", "/api/admin/vendor-review-campaigns/reminders", {}),
  optOut: (email: string) =>
    apiFetch<{ ok: true; created: boolean }>("POST", "/api/admin/vendor-review-campaigns/optout", {
      email,
    }),
};

/** Admin console for the personal-invite campaign — the founder's own contacts,
 *  imported from a CSV. `import` dedups server-side (against `users` +
 *  `email_optouts`) and returns the breakdown; everything beyond the supervised
 *  `sendBatch` is paced by the worker. */
export const adminPersonalInviteCampaignApi = {
  list: () =>
    apiFetch<{ campaigns: PersonalInviteCampaign[] }>(
      "GET",
      "/api/admin/personal-invite/campaigns",
    ),
  create: (body: CreatePersonalInviteCampaignInput) =>
    apiFetch<{ campaign: PersonalInviteCampaign }>(
      "POST",
      "/api/admin/personal-invite/campaigns",
      body,
    ),
  detail: (id: number) =>
    apiFetch<PersonalInviteCampaignDetail>("GET", `/api/admin/personal-invite/campaigns/${id}`),
  update: (id: number, body: UpdatePersonalInviteCampaignInput) =>
    apiFetch<{ campaign: PersonalInviteCampaign }>(
      "PATCH",
      `/api/admin/personal-invite/campaigns/${id}`,
      body,
    ),
  import: (id: number, body: ImportPersonalInviteContactsInput) =>
    apiFetch<{ result: PersonalInviteImportResult; stats: PersonalInviteCampaignStats }>(
      "POST",
      `/api/admin/personal-invite/campaigns/${id}/import`,
      body,
    ),
  sends: (id: number) =>
    apiFetch<{ sends: PersonalInviteCampaignSend[] }>(
      "GET",
      `/api/admin/personal-invite/campaigns/${id}/sends`,
    ),
  sendBatch: (id: number, limit: number) =>
    apiFetch<{ sent: number; stats: PersonalInviteCampaignStats }>(
      "POST",
      `/api/admin/personal-invite/campaigns/${id}/send-batch`,
      { limit },
    ),
};

/** Onboarding re-engagement campaign — admin re-nudge of registered couples who
 *  never onboarded. Like personal-invite but the audience is a LIVE orphan
 *  query, so `sync` (snapshot the current segment) replaces the CSV `import`. */
export const adminOnboardingCampaignApi = {
  list: () =>
    apiFetch<{ campaigns: OnboardingCampaign[] }>("GET", "/api/admin/onboarding-campaigns"),
  create: (body: CreateOnboardingCampaignInput) =>
    apiFetch<{ campaign: OnboardingCampaign }>("POST", "/api/admin/onboarding-campaigns", body),
  detail: (id: number) =>
    apiFetch<OnboardingCampaignDetail>("GET", `/api/admin/onboarding-campaigns/${id}`),
  update: (id: number, body: UpdateOnboardingCampaignInput) =>
    apiFetch<{ campaign: OnboardingCampaign }>(
      "PATCH",
      `/api/admin/onboarding-campaigns/${id}`,
      body,
    ),
  sync: (id: number) =>
    apiFetch<{ result: OnboardingCampaignSyncResult; stats: OnboardingCampaignStats }>(
      "POST",
      `/api/admin/onboarding-campaigns/${id}/sync`,
      {},
    ),
  sends: (id: number) =>
    apiFetch<{ sends: OnboardingCampaignSend[] }>(
      "GET",
      `/api/admin/onboarding-campaigns/${id}/sends`,
    ),
  sendBatch: (id: number, limit: number) =>
    apiFetch<{ sent: number; stats: OnboardingCampaignStats }>(
      "POST",
      `/api/admin/onboarding-campaigns/${id}/send-batch`,
      { limit },
    ),
};

/** The standing campaign plan: one schedule per campaign family, composing the
 *  next round on its own interval. `prepare` is "don't wait for the due date",
 *  `run` launches the campaign a schedule has already built. */
export const adminCampaignScheduleApi = {
  list: () => apiFetch<CampaignPlanView>("GET", "/api/admin/campaign-schedules"),
  update: (id: number, body: UpdateCampaignScheduleInput) =>
    apiFetch<CampaignScheduleView>("PATCH", `/api/admin/campaign-schedules/${id}`, body),
  prepare: (id: number) =>
    apiFetch<{
      result: {
        prepared: boolean;
        reason: string | null;
        campaign_id: number | null;
        reach: number;
        cooling_down: number;
        suppressed: number;
      };
      item: CampaignScheduleView;
    }>("POST", `/api/admin/campaign-schedules/${id}/prepare`, {}),
  run: (id: number) =>
    apiFetch<{ item: CampaignScheduleView }>("POST", `/api/admin/campaign-schedules/${id}/run`, {}),
};

/** Vendor listing-claim flow — P2.C. Three steps:
 *  1. `start` — anonymous, hits the listing's email-on-file
 *  2. `verify` — read-only token check, returns the claim view for the page
 *  3. `complete` — atomic create user + vendor_account + flip listing, returns
 *     a fresh AuthSession the caller must install via useAuth().setSession. */
export const vendorClaimApi = {
  start: (body: StartClaimInput) =>
    apiFetch<{ ok: true; sent_to_masked: string }>("POST", "/api/vendor/claim/start", body),
  verify: (token: string) =>
    apiFetch<{ claim: ClaimVerifyView }>(
      "POST",
      `/api/vendor/claim/verify/${encodeURIComponent(token)}`,
      {},
    ),
  complete: (body: CompleteClaimInput) =>
    apiFetch<AuthSession>("POST", "/api/vendor/claim/complete", body),
};

/** Vendor onboarding flow — the accepted-waitlist → live vendor path. Two steps:
 *  1. `verify` — read the token view (business name + founding spots left) to
 *     prefill the activate screen; doesn't consume the token.
 *  2. `complete` — create user(role=vendor) + vendor_account + a live listing +
 *     a founding/trial subscription, returns a fresh AuthSession to install via
 *     useAuth().setSession. No card is asked — the first 100 vendors are free
 *     for a year. */
/** Self-serve vendor signup — creates a role='vendor' account and returns a
 *  session (persist via useAuth().setSession, then run the in-app onboarding
 *  wizard at /vendor/onboarding). Replaces the waitlist + token-activation flow. */
export const vendorAuthApi = {
  register: (body: {
    email: string;
    password: string;
    full_name: string;
    business_name: string;
    /** Legal company name shown small under the brand; optional. */
    company_name?: string;
    category: string;
    /** Required when category === "other": the vendor-written service label. */
    custom_category?: string;
    country?: string;
    registry_number?: string;
    vat_number?: string;
    legal_form?: string;
    address?: string;
    city?: string;
    postal_code?: string;
    contact_phone?: string;
    website?: string;
    privacy_version: string;
    terms_version: string;
    locale?: string;
    referrer?: string;
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    utm_content?: string;
    utm_term?: string;
  }) => apiFetch<AuthSession>("POST", "/api/vendor/register", body),

  /** Google-based vendor signup: the identity comes from a verified Google
   *  `credential` (held from step 1) instead of email + password; the business
   *  (step 2) fields ride along, same as the password register. */
  registerGoogle: (body: {
    credential: string;
    business_name: string;
    company_name?: string;
    category: string;
    custom_category?: string;
    country?: string;
    registry_number?: string;
    vat_number?: string;
    legal_form?: string;
    address?: string;
    city?: string;
    postal_code?: string;
    contact_phone?: string;
    website?: string;
    privacy_version: string;
    terms_version: string;
    locale?: string;
    referrer?: string;
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    utm_content?: string;
    utm_term?: string;
  }) => apiFetch<AuthSession>("POST", "/api/vendor/register/google", body),
};

/** @deprecated Legacy waitlist → admin-accept → emailed token activation flow.
 *  Superseded by self-serve `vendorAuthApi.register`; kept until the backend
 *  token routes are removed. */
export const vendorOnboardingApi = {
  verify: (token: string) =>
    apiFetch<{ onboarding: VendorOnboardingVerifyView }>(
      "POST",
      `/api/vendor/onboard/verify/${encodeURIComponent(token)}`,
      {},
    ),
  complete: (body: CompleteVendorOnboardingInput) =>
    apiFetch<AuthSession>("POST", "/api/vendor/onboard/complete", body),
};

/** Vendor self-serve listing editor — P2.D. The vendor lands on /vendor after
 *  the claim flow finishes; this is the only screen they have today. */
/** DeepL-backed auto-translate for the bilingual vendor "Leírás" fields.
 *  `availability` is a feature-flag probe (hides the button when no DeepL key
 *  is configured server-side); `translate` does the HU <-> EN round-trip. */
export const translateApi = {
  availability: () => apiFetch<TranslateAvailability>("GET", "/api/translate/availability"),
  translate: (body: TranslateRequest) => apiFetch<TranslateResult>("POST", "/api/translate", body),
};

export const vendorListingApi = {
  me: () => apiFetch<VendorListingView>("GET", "/api/vendor/listing/me"),
  patch: (body: VendorListingEditInput) =>
    apiFetch<VendorListingView>("PATCH", "/api/vendor/listing/me", body),
  /** Self-serve pause/unpause: flips listings.status 'active' <-> 'hidden'.
   *  Moderation states are refused server-side with 409. */
  setVisibility: (published: boolean) =>
    apiFetch<VendorListingView>("POST", "/api/vendor/listing/me/visibility", { published }),
  /** Multipart-only — `apiFetch` is JSON-shaped, so the hero upload bypasses
   *  it and posts FormData directly. The route accepts JPEG/PNG/WebP up to
   *  4 MB; the server enforces the constraints + writes a cache-busted URL
   *  back into the returned view. */
  uploadHero: async (file: File): Promise<VendorListingView> => {
    const form = new FormData();
    form.append("file", file);
    const token = getToken();
    const res = await fetch("/api/vendor/listing/me/hero", {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    const text = await res.text();
    if (!res.ok) {
      let parsed: { code?: string; message?: string } | null = null;
      try {
        parsed = text ? (JSON.parse(text) as { code?: string; message?: string }) : null;
      } catch {
        parsed = null;
      }
      // The route's content-validation rejections (400 / 413 / 415) map to
      // `client_error`; any 5xx is `server_error`. Both share the same
      // user-facing toast in VendorHomePage; only the code matters for any
      // future branching.
      throw new ApiError(
        res.status,
        res.status >= 500 ? "server_error" : "client_error",
        parsed?.message ?? text ?? "Upload failed",
        parsed,
      );
    }
    return JSON.parse(text) as VendorListingView;
  },
  deleteHero: () => apiFetch<VendorListingView>("DELETE", "/api/vendor/listing/me/hero"),
  /** Portfolio gallery upload — same multipart pipeline + constraints as the
   *  hero (JPEG/PNG/WebP, 4 MB); 409 code 'gallery_full' at the cap. The
   *  returned view carries the refreshed `photos` array. */
  uploadPhoto: (file: File): Promise<VendorListingView> => {
    const form = new FormData();
    form.append("file", file);
    return uploadMultipart<VendorListingView>("POST", "/api/vendor/listing/me/photos", form);
  },
  /** Vertical focal point for one gallery photo (object-position %, 0..100).
   *  Fires on drag release in the editor; the server clamps, so an over-drag
   *  is fine. Returns the refreshed view like every other gallery call. */
  updatePhotoPosition: (photoId: number, positionY: number) =>
    apiFetch<VendorListingView>("PATCH", `/api/vendor/listing/me/photos/${photoId}`, {
      position_y: positionY,
    }),
  deletePhoto: (photoId: number) =>
    apiFetch<VendorListingView>("DELETE", `/api/vendor/listing/me/photos/${photoId}`),
  /** Video reel — pasted links, not uploads, so these are plain JSON calls.
   *  The server parses + validates the URL (400 `invalid_video_url` on a bad
   *  paste, 409 `videos_full` at the cap) and returns the refreshed view with
   *  the `videos` array in drag order. */
  addVideo: (url: string) =>
    apiFetch<VendorListingView>("POST", "/api/vendor/listing/me/videos", { url }),
  updateVideo: (videoId: number, url: string) =>
    apiFetch<VendorListingView>("PATCH", `/api/vendor/listing/me/videos/${videoId}`, { url }),
  deleteVideo: (videoId: number) =>
    apiFetch<VendorListingView>("DELETE", `/api/vendor/listing/me/videos/${videoId}`),
  /** Persist a drag reorder: the full list of video row ids in the new order. */
  reorderVideos: (orderedIds: number[]) =>
    apiFetch<VendorListingView>("PATCH", "/api/vendor/listing/me/videos/reorder", {
      ordered_ids: orderedIds,
    }),
  /** Price offers / packages (árajánlat). Text fields are plain JSON; the
   *  optional PDF is a separate multipart call. The server enforces the max-3
   *  cap (409 `packages_full`) and returns the refreshed view with `packages`. */
  addPackage: (body: { name: string; price_text?: string | null; description?: string | null }) =>
    apiFetch<VendorListingView>("POST", "/api/vendor/listing/me/packages", body),
  updatePackage: (
    packageId: number,
    body: { name?: string; price_text?: string | null; description?: string | null },
  ) => apiFetch<VendorListingView>("PATCH", `/api/vendor/listing/me/packages/${packageId}`, body),
  deletePackage: (packageId: number) =>
    apiFetch<VendorListingView>("DELETE", `/api/vendor/listing/me/packages/${packageId}`),
  /** Attach a price-list PDF to a package (multipart, application/pdf, 8 MB).
   *  Overwrites any existing PDF on that package. Returns the refreshed view. */
  uploadPackagePdf: (packageId: number, file: File): Promise<VendorListingView> => {
    const form = new FormData();
    form.append("file", file);
    return uploadMultipart<VendorListingView>(
      "POST",
      `/api/vendor/listing/me/packages/${packageId}/pdf`,
      form,
    );
  },
  deletePackagePdf: (packageId: number) =>
    apiFetch<VendorListingView>("DELETE", `/api/vendor/listing/me/packages/${packageId}/pdf`),
  /** Marks the post-signup onboarding wizard complete so the dashboard stops
   *  redirecting back into it. Returns the refreshed view (account.onboarding_done
   *  is now true). Idempotent. */
  completeOnboarding: () => apiFetch<VendorListingView>("POST", "/api/vendor/onboarding/complete"),
};

/** Vendor self-serve account (company identity) + data takeout. The account
 *  PATCH edits the legal-payee fields (display name, contact, VAT, registry,
 *  address) — the PUBLIC listing stays on vendorListingApi. */
export const vendorAccountApi = {
  update: (body: VendorAccountEditInput) =>
    apiFetch<{ account: VendorAccount }>("PATCH", "/api/vendor/account", body),
  /** Full JSON snapshot of the vendor's data (account + listings + billing +
   *  clients incl. payments + blocked dates); the caller serialises it into a
   *  downloadable file. */
  export: () => apiFetch<VendorDataExport>("GET", "/api/vendor/export"),
};

/** Vendor self-serve availability — the booked/blocked days a claimed vendor
 *  manages from /vendor. Every call returns the full refreshed view so the UI
 *  re-renders from the server's truth after each block/unblock. */
export const vendorAvailabilityApi = {
  me: () => apiFetch<VendorAvailabilityView>("GET", "/api/vendor/availability/me"),
  /** `hours` null/omitted = block the whole day; a non-empty hour list (0-23)
   *  blocks only those hours (a partial-day block). */
  block: (date: string, hours?: number[] | null, reason?: string) =>
    apiFetch<VendorAvailabilityView>("POST", "/api/vendor/availability/me", {
      date,
      hours: hours ?? null,
      reason,
    }),
  unblock: (date: string) =>
    apiFetch<VendorAvailabilityView>(
      "DELETE",
      `/api/vendor/availability/me?date=${encodeURIComponent(date)}`,
    ),
};

/** Vendor to-do board: private, vendor-scoped tasks on the kanban at
 *  /vendor/calendar?mode=tasks. FREE-tier surface (couples never see it). */
export const vendorTaskApi = {
  list: () => apiFetch<{ tasks: VendorTask[] }>("GET", "/api/vendor/tasks"),
  create: (body: VendorTaskCreateInput) =>
    apiFetch<{ task: VendorTask }>("POST", "/api/vendor/tasks", body),
  update: (id: number, body: VendorTaskUpdateInput) =>
    apiFetch<{ task: VendorTask }>("PATCH", `/api/vendor/tasks/${id}`, body),
  move: (id: number, board_status: VendorBoardStatus) =>
    apiFetch<{ task: VendorTask }>("PATCH", `/api/vendor/tasks/${id}`, { board_status }),
  remove: (id: number) => apiFetch<{ ok: true }>("DELETE", `/api/vendor/tasks/${id}`),
};

/** Vendor "clients" — couples that reached the vendor THROUGH Weddly (their
 *  Weddly-sourced bookings). The basic list is FREE; the CRM detail + payment
 *  tracking are PRO-gated server-side (a FREE vendor gets a 403 the UI turns
 *  into an upgrade prompt). `id` is the supplier_bookings.id. */
export const vendorClientsApi = {
  list: () => apiFetch<{ clients: VendorClientView[] }>("GET", "/api/vendor/clients"),
  get: (id: number) => apiFetch<VendorClientDetail>("GET", `/api/vendor/clients/${id}`),
  update: (
    id: number,
    body: {
      status?: string;
      stage?: string | null;
      vendor_notes?: string | null;
      contract_value?: number | null;
      deposit_paid?: number | null;
    },
  ) => apiFetch<{ client: VendorClientDetail }>("PATCH", `/api/vendor/clients/${id}`, body),
  listPayments: (id: number) =>
    apiFetch<{ payments: VendorClientPayment[] }>("GET", `/api/vendor/clients/${id}/payments`),
  addPayment: (id: number, body: { label: string; amount: number; due_date: string | null }) =>
    apiFetch<{ payment: VendorClientPayment }>("POST", `/api/vendor/clients/${id}/payments`, body),
  updatePayment: (
    paymentId: number,
    body: { label?: string; amount?: number; due_date?: string | null; paid?: boolean },
  ) =>
    apiFetch<{ payment: VendorClientPayment }>("PATCH", `/api/vendor/payments/${paymentId}`, body),
  deletePayment: (paymentId: number) =>
    apiFetch<{ ok: true }>("DELETE", `/api/vendor/payments/${paymentId}`),
};

/** Vendor dashboard / stats rollup for the signed-in vendor's account. */
export const vendorStatsApi = {
  get: () => apiFetch<VendorStats>("GET", "/api/vendor/stats"),
};

/** Weddly Points: the vendor's derived total, tier, perks and recent ledger.
 *  Read-only by design — points are only ever written by the server-side engine
 *  consuming domain events, never by a client call. */
export const vendorPointsApi = {
  get: () => apiFetch<VendorPointsStatus>("GET", "/api/vendor/points"),
};

/** Vendor billing snapshot + derived FREE/PRO plan + per-feature flags, plus
 *  the freemium money path (Stripe-hosted card setup / checkout / portal). */
export const vendorBillingApi = {
  get: () =>
    apiFetch<VendorBillingStatus & { plan: VendorPlan; features: VendorFeatureFlags }>(
      "GET",
      "/api/vendor/billing",
    ),
  /** Stripe Checkout in SETUP mode: save a card, no charge (opens the
   *  3-free-inquiries lead window). Returns the hosted checkout URL. */
  setup: () => apiFetch<{ url: string }>("POST", "/api/vendor/billing/setup"),
  /** Classic subscription Checkout: the lapsed-vendor recovery path. */
  checkout: () => apiFetch<{ url: string }>("POST", "/api/vendor/billing/checkout"),
  portal: () => apiFetch<{ url: string }>("POST", "/api/vendor/billing/portal"),
  /** Masked card + invoice history, read straight from Stripe. Answers with an
   *  empty `billing_active: false` payload rather than an error when there is
   *  no Stripe customer yet, so the settings tab never has to handle a 503. */
  details: () =>
    apiFetch<import("@shared/vendor_billing").VendorBillingDetails>(
      "GET",
      "/api/vendor/billing/details",
    ),
};

/** Supplier Outreach Inbox (P2.E v1). Couple-facing endpoints; the
 *  vendor's reply lands in the couple's own email inbox today (Reply-To
 *  is the couple owner's address) — the in-app outreach section on
 *  /app/vendors shows sent history only until the v1.5 inbound webhook
 *  ships. */
export const outreachApi = {
  list: () => apiFetch<{ campaigns: OutreachCampaign[] }>("GET", "/api/outreach/campaigns"),
  detail: (id: number) => apiFetch<OutreachCampaignDetail>("GET", `/api/outreach/campaigns/${id}`),
  create: (body: CreateOutreachCampaignInput) =>
    apiFetch<OutreachCampaignDetail>("POST", "/api/outreach/campaigns", body),
};

export interface SubmitVendorWaitlistForm {
  business_name: string;
  email: string;
  category: string;
  location: string | null;
  website: string | null;
  message: string | null;
  portfolio_links: string[];
  instagram_handle: string | null;
  price_list: File | null;
  travel_radius_km: number | null;
  tax_number: string | null;
  registration_number: string | null;
  privacy_version: string;
  vendor_beta_notice_version: string;
  /** Referral invite code from ?ref_code= on the vendor URL. */
  ref_code?: string;
}

export const vendorWaitlistApi = {
  submit: async (input: SubmitVendorWaitlistForm): Promise<{ entry: VendorWaitlistEntry }> => {
    const form = new FormData();
    form.append("business_name", input.business_name);
    form.append("email", input.email);
    form.append("category", input.category);
    if (input.location) form.append("location", input.location);
    if (input.website) form.append("website", input.website);
    if (input.message) form.append("message", input.message);
    if (input.instagram_handle) form.append("instagram_handle", input.instagram_handle);
    for (const link of input.portfolio_links) form.append("portfolio_links[]", link);
    if (input.price_list) form.append("price_list", input.price_list);
    if (input.travel_radius_km !== null)
      form.append("travel_radius_km", String(input.travel_radius_km));
    if (input.tax_number) form.append("tax_number", input.tax_number);
    if (input.registration_number) form.append("registration_number", input.registration_number);
    form.append("privacy_version", input.privacy_version);
    form.append("vendor_beta_notice_version", input.vendor_beta_notice_version);
    if (input.ref_code) form.append("ref_code", input.ref_code);

    const res = await fetch("/api/vendors/waitlist", { method: "POST", body: form });
    const text = await res.text();
    if (!res.ok) {
      let parsed: { message?: string } | null = null;
      try {
        parsed = text ? (JSON.parse(text) as { message?: string }) : null;
      } catch {
        parsed = null;
      }
      throw new ApiError(
        res.status,
        res.status >= 500 ? "server_error" : "client_error",
        parsed?.message ?? text ?? "Submit failed",
        parsed,
      );
    }
    return JSON.parse(text) as { entry: VendorWaitlistEntry };
  },
};

export interface SubmitPlannerWaitlistForm {
  full_name: string;
  email: string;
  phone: string | null;
  company_name: string | null;
  city: string | null;
  message: string | null;
  privacy_version: string;
  selected_plan: "basic" | "pro" | "unlimited" | null;
  website: string | null;
  weddings_per_year: number | null;
  km_radius: number | null;
  wedding_style_1: string | null;
  wedding_style_2: string | null;
  wedding_style_3: string | null;
  other_style: string | null;
  reference_links: string | null;
  early_bird: boolean;
}

export const plannerWaitlistApi = {
  submit: async (input: SubmitPlannerWaitlistForm): Promise<{ entry: { id: number } }> => {
    const res = await fetch("/api/planners/waitlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const text = await res.text();
    if (!res.ok) {
      let parsed: { message?: string } | null = null;
      try {
        parsed = text ? (JSON.parse(text) as { message?: string }) : null;
      } catch {
        parsed = null;
      }
      throw new ApiError(
        res.status,
        res.status >= 500 ? "server_error" : "client_error",
        parsed?.message ?? text ?? "Submit failed",
        parsed,
      );
    }
    return JSON.parse(text) as { entry: { id: number } };
  },
};

export const adminPlannerWaitlistApi = {
  list: (status?: string) =>
    apiFetch<{ entries: PlannerWaitlistAdminView[] }>(
      "GET",
      `/api/admin/planner-waitlist${status ? `?status=${status}` : ""}`,
    ),
  decide: (id: number, body: DecidePlannerWaitlistInput) =>
    apiFetch<{ entry: PlannerWaitlistAdminView | null }>(
      "POST",
      `/api/admin/planner-waitlist/${id}/decide`,
      { body: JSON.stringify(body) },
    ),
  reopen: (id: number) =>
    apiFetch<{ entry: PlannerWaitlistAdminView | null }>(
      "POST",
      `/api/admin/planner-waitlist/${id}/reopen`,
    ),
};

export interface FeedbackInput {
  /** Where the dialog was opened from. Defaults server-side to "landing"
   *  when omitted (back-compat). */
  source?: "landing" | "app";
  /** In-app route the dialog was opened from (e.g. "/app/media"), so admins
   *  can see which surface in-product feedback is about. App-source only. */
  context?: string;
  /** Full URL (window.location.href) so admins can reproduce exactly. */
  url?: string;
  message?: string;
  rating?: number;
  monthly_value_ft?: number;
  from_email?: string;
  locale?: string;
}

export const feedbackApi = {
  submit: (body: FeedbackInput) => apiFetch<{ ok: true }>("POST", "/api/feedback", body),
};

export interface EmailPreferences {
  /** True = opted out of lifecycle/reminder emails (transactional mail —
   *  verification, password reset, RSVP — is unaffected). */
  lifecycle_opt_out: boolean;
  unsubscribe_token: string;
}

export const emailPrefsApi = {
  get: () => apiFetch<EmailPreferences>("GET", "/api/account/email-preferences"),
  update: (lifecycle_opt_out: boolean) =>
    apiFetch<{ ok: true; lifecycle_opt_out: boolean }>("POST", "/api/account/email-preferences", {
      lifecycle_opt_out,
    }),
};

export type CoupleCardRating = "bad" | "ok" | "great";

export interface CoupleCardFeedbackInput {
  deck_id: string;
  card_index: number;
  rating: CoupleCardRating;
  locale: "hu" | "en";
  question_snapshot: string;
}

export interface CoupleCardFeedbackAggregate {
  deck_id: string;
  card_index: number;
  locale: "hu" | "en";
  question_snapshot: string;
  bad_count: number;
  ok_count: number;
  great_count: number;
  total: number;
  last_at: number;
}

export interface CoupleCardSuggestionInput {
  deck_id: string;
  locale: "hu" | "en";
  suggestion: string;
}

export interface CoupleCardSuggestion {
  id: number;
  deck_id: string;
  locale: "hu" | "en";
  suggestion: string;
  created_at: number;
}

export const coupleCardsApi = {
  submitFeedback: (body: CoupleCardFeedbackInput) =>
    apiFetch<{ ok: true }>("POST", "/api/couple-cards/feedback", body),
  submitSuggestion: (body: CoupleCardSuggestionInput) =>
    apiFetch<{ ok: true }>("POST", "/api/couple-cards/suggestions", body),
};

export const adminCoupleCardsApi = {
  list: () =>
    apiFetch<{ items: CoupleCardFeedbackAggregate[] }>("GET", "/api/admin/couple-cards/feedback"),
  listSuggestions: () =>
    apiFetch<{ items: CoupleCardSuggestion[] }>("GET", "/api/admin/couple-cards/suggestions"),
};

/** Read-only analytics surfaces for the admin dashboard. Four orthogonal
 *  GET endpoints — money, activity, picks, engagement — each returns the
 *  aggregated view in one round-trip. See `shared/admin_analytics.ts` for
 *  the response shapes. */
export const adminFinancialPlannerApi = {
  overview: () =>
    apiFetch<AdminFinancialPlannerOverview>("GET", "/api/admin/financial-planner/overview"),
  /** Flip the global read-only paywall (the manual go-live). Returns the fresh
   *  overview so the page reflects the new state without a refetch. */
  setEnforcement: (on: boolean) =>
    apiFetch<AdminFinancialPlannerOverview>("POST", "/api/admin/financial-planner/enforcement", {
      on,
    }),
  /** Stripe connection + config health (admin monitor). Live API ping when a
   *  key is set; config-readiness only when billing isn't wired up yet. */
  stripeHealth: () => apiFetch<StripeHealth>("GET", "/api/admin/financial-planner/stripe-health"),
  /** Live EUR→HUF/USD/CNY rate (server-fetched market mid). null when the
   *  upstream FX feed is unreachable. */
  fx: () => apiFetch<FxRates | null>("GET", "/api/admin/financial-planner/fx"),
};

/** Serialise the audience toggles to a query string. Only the flipped-on
 *  flags are emitted, so the bare/default call is a clean "real users only"
 *  request. */
function audienceQuery(a?: AnalyticsAudience): string {
  if (!a) return "";
  const p = new URLSearchParams();
  if (a.includeAdmins) p.set("include_admins", "1");
  if (a.includeTest) p.set("include_test", "1");
  if (a.includeDemos) p.set("include_demos", "1");
  if (a.includeArchived) p.set("include_archived", "1");
  if (a.includeDeleting) p.set("include_deleting", "1");
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const adminAnalyticsApi = {
  // The couple-/user-shaped lenses honour the audience filter.
  money: (a?: AnalyticsAudience) =>
    apiFetch<AdminMoneyAnalytics>("GET", `/api/admin/analytics/money${audienceQuery(a)}`),
  activity: (a?: AnalyticsAudience) =>
    apiFetch<AdminActivityAnalytics>("GET", `/api/admin/analytics/activity${audienceQuery(a)}`),
  picks: (a?: AnalyticsAudience) =>
    apiFetch<AdminPicksAnalytics>("GET", `/api/admin/analytics/picks${audienceQuery(a)}`),
  engagement: (a?: AnalyticsAudience) =>
    apiFetch<AdminEngagementAnalytics>("GET", `/api/admin/analytics/engagement${audienceQuery(a)}`),
  honeymoon: (a?: AnalyticsAudience) =>
    apiFetch<AdminHoneymoonAnalytics>("GET", `/api/admin/analytics/honeymoon${audienceQuery(a)}`),
  weddings: (a?: AnalyticsAudience) =>
    apiFetch<AdminWeddingAnalytics>("GET", `/api/admin/analytics/weddings${audienceQuery(a)}`),
  guests: (a?: AnalyticsAudience) =>
    apiFetch<AdminGuestAnalytics>("GET", `/api/admin/analytics/guests${audienceQuery(a)}`),
  acquisition: (a?: AnalyticsAudience) =>
    apiFetch<AdminAcquisitionAnalytics>(
      "GET",
      `/api/admin/analytics/acquisition${audienceQuery(a)}`,
    ),
  planners: (a?: AnalyticsAudience) =>
    apiFetch<AdminPlannerAnalytics>("GET", `/api/admin/analytics/planners${audienceQuery(a)}`),
  users: (a?: AnalyticsAudience) =>
    apiFetch<AdminUserAnalytics>("GET", `/api/admin/analytics/users${audienceQuery(a)}`),
  // Demo is itself the demo lens; traffic is external GA4; campaigns count
  // outbound mail to people who mostly have no account at all — none of the
  // three takes the audience filter.
  demo: () => apiFetch<AdminDemoAnalytics>("GET", "/api/admin/analytics/demo"),
  campaigns: () => apiFetch<AdminCampaignAnalytics>("GET", "/api/admin/analytics/campaigns"),
  traffic: () => apiFetch<AdminTrafficAnalytics>("GET", "/api/admin/analytics/traffic"),
};

export const adminFeedbackApi = {
  list: () => apiFetch<{ entries: FeedbackEntry[] }>("GET", "/api/admin/feedback"),
  setStatus: (id: number, status: FeedbackStatus) =>
    apiFetch<{ entry: FeedbackEntry }>("PATCH", `/api/admin/feedback/${id}/status`, { status }),
  /** Update triage fields. Omit a key to leave it unchanged; pass null to
   *  clear it. */
  triage: (
    id: number,
    patch: {
      priority?: FeedbackPriority | null;
      feature_area?: string | null;
      admin_notes?: string | null;
    },
  ) => apiFetch<{ entry: FeedbackEntry }>("PATCH", `/api/admin/feedback/${id}`, patch),
  /** Reply to the submitter via email and/or an in-app bell notification.
   *  Returns the refreshed entry (with the new reply appended) plus a
   *  per-channel delivery report. */
  reply: (id: number, body: { message: string; channel: FeedbackReplyChannel }) =>
    apiFetch<{
      entry: FeedbackEntry;
      delivery: { email: string | null; notified: boolean };
    }>("POST", `/api/admin/feedback/${id}/reply`, body),
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

export const adminEmailListApi = {
  list: () => apiFetch<AdminEmailListResponse>("GET", "/api/admin/email-list"),
};

export const adminEmailPreviewApi = {
  list: () =>
    apiFetch<{ kinds: { kind: string; category: string; subject: string }[] }>(
      "GET",
      "/api/admin/email-preview",
    ),
  render: (kind: string, locale?: "hu" | "en") => {
    const qs = locale ? `?locale=${locale}` : "";
    return apiFetch<{ html: string; subject: string }>(
      "GET",
      `/api/admin/email-preview/${kind}${qs}`,
    );
  },
};

export const supplierTaxonomyApi = {
  list: () => apiFetch<SupplierTaxonomy>("GET", "/api/supplier-categories"),
};

export const adminSupplierTaxonomyApi = {
  /** Admin view of the taxonomy — includes hidden groups + categories so
   *  the editor can render them with a "Hidden" badge + unhide button.
   *  The public `supplierTaxonomyApi.list()` filters hidden rows out. */
  list: () => apiFetch<SupplierTaxonomy>("GET", "/api/admin/supplier-taxonomy"),
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
  /** Admin-gated kickoff of the verify mail. Submissions land as 'pending'
   *  now and stay quiet until admin clicks this — prevents anyone with a
   *  Weddly account from blasting verifications at arbitrary inboxes. */
  sendVerify: (id: number) =>
    apiFetch<{ supplier: CommunitySupplierAdminView }>(
      "POST",
      `/api/admin/suppliers/${id}/send-verify`,
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
  /** Purge the ENTIRE submitter account behind a community supplier (user row +
   *  all owned data). Far more destructive than `remove`, which only deletes the
   *  single listing. `id` is the numeric community supplier id. */
  purgeSubmitter: (id: number) =>
    apiFetch<{ ok: true }>("POST", `/api/admin/suppliers/${id}/purge-submitter`, {}),
  /** Hide a curated (code-resident) supplier from the public directory. Keeps it
   *  in the admin catalog as `hidden` and restorable. `slug` is the curated id. */
  hideCurated: (slug: string, reason?: string) =>
    apiFetch<{ ok: true; status: "hidden" }>(
      "POST",
      `/api/admin/suppliers/curated/${encodeURIComponent(slug)}/hide`,
      { reason: reason ?? null },
    ),
  /** Restore a hidden/deleted curated supplier to its code-defined active state. */
  unhideCurated: (slug: string) =>
    apiFetch<{ ok: true; status: "active" }>(
      "POST",
      `/api/admin/suppliers/curated/${encodeURIComponent(slug)}/unhide`,
      {},
    ),
  /** Tombstone a curated supplier (removes it from both the public directory and
   *  the admin catalog). The override persists across deploys. */
  removeCurated: (slug: string, reason?: string) =>
    apiFetch<{ ok: true }>("DELETE", `/api/admin/suppliers/curated/${encodeURIComponent(slug)}`, {
      reason: reason ?? null,
    }),
  /** Re-pull the card hero from a listing's own website (og:image), bypassing
   *  the size quality gate (manual override). Accepts any listing id — a curated
   *  slug, `c<id>`, or `v<id>`. Returns whether an image was stored + the new
   *  hero URL (null when the site had nothing usable). */
  refetchHero: (listingId: string) =>
    apiFetch<{ ok: boolean; hero_image_url: string | null }>(
      "POST",
      `/api/admin/suppliers/${encodeURIComponent(listingId)}/refetch-hero`,
      {},
    ),
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
  if (f.contact && f.contact !== "all") p.set("contact", f.contact);
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

/** A6 table-number cards - one card per seating table. Styled from the
 *  couple's design (palette + fonts). Download via `fetchPdfBlob`. */
export const tableNumbersPdfUrl = "/api/print/table-numbers";

/** A5 menu cards in the couple's wedding style. Download via `fetchPdfBlob`. */
export const menuPdfUrl = "/api/print/menu";

/** A5 portrait invitation in the couple's wedding style. Download via `fetchPdfBlob`. */
export const invitationPdfUrl = "/api/print/invitation";

/** A6 thank-you cards in the couple's wedding style. Download via `fetchPdfBlob`. */
export const thankYouPdfUrl = "/api/print/thank-you";

// ─── Wedding Film / Photo album ───────────────────────────────────────────────

async function publicFilmFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let backendCode: string | undefined;
    let msg = "Request failed";
    try {
      const p = JSON.parse(text) as { code?: string; message?: string };
      if (p.code) backendCode = p.code;
      if (p.message) msg = p.message;
    } catch {
      /* */
    }
    const apiCode = res.status >= 500 ? "server_error" : "client_error";
    throw new ApiError(res.status, apiCode, msg, backendCode ? { code: backendCode } : undefined);
  }
  return res.json() as Promise<T>;
}

export const photoAlbumApi = {
  /** Pricing eligibility check for the current couple. */
  filmAccess: (): Promise<{ access: FilmAccessCheck }> =>
    apiFetch<{ access: FilmAccessCheck }>("GET", "/api/photo-albums/film-access"),

  /** Stripe Checkout session for the €9.90 film unlock. Returns the Stripe-hosted URL. */
  filmCheckout: (): Promise<{ url: string }> =>
    apiFetch<{ url: string }>("POST", "/api/photo-albums/checkout", {}),

  /** Create (or return existing) the couple's film. */
  create(
    opts: {
      title?: string;
      filmAesthetic?: FilmAesthetic;
      shotsPerGuest?: number | null;
      revealAt?: number | null;
      eventEndsAt?: number | null;
      coverImageUrl?: string | null;
    } = {},
  ): Promise<{ album: PhotoAlbum }> {
    const body: Record<string, unknown> = {};
    if (opts.title !== undefined) body.title = opts.title;
    if (opts.filmAesthetic !== undefined) body.film_aesthetic = opts.filmAesthetic;
    if (opts.shotsPerGuest !== undefined) body.shots_per_guest = opts.shotsPerGuest;
    if (opts.revealAt !== undefined) body.reveal_at = opts.revealAt;
    if (opts.eventEndsAt !== undefined) body.event_ends_at = opts.eventEndsAt;
    if (opts.coverImageUrl !== undefined) body.cover_image_url = opts.coverImageUrl;
    return apiFetch<{ album: PhotoAlbum }>("POST", "/api/photo-albums", body);
  },

  /** Fetch the current couple's album (null if none exists). */
  current: (): Promise<{ album: PhotoAlbum | null }> =>
    apiFetch<{ album: PhotoAlbum | null }>("GET", "/api/photo-albums/current"),

  /** Update album settings. */
  update(patch: {
    isUploadEnabled?: boolean;
    shotsPerGuest?: number | null;
    title?: string | null;
    filmAesthetic?: FilmAesthetic;
    revealAt?: number | null;
    eventEndsAt?: number | null;
    coverImageUrl?: string | null;
    /** Custom guest-link slug (#17); null clears it. */
    slug?: string | null;
  }): Promise<{ album: PhotoAlbum }> {
    const body: Record<string, unknown> = {};
    if ("isUploadEnabled" in patch) body.is_upload_enabled = patch.isUploadEnabled;
    if ("shotsPerGuest" in patch) body.shots_per_guest = patch.shotsPerGuest ?? null;
    if ("title" in patch) body.title = patch.title ?? null;
    if ("filmAesthetic" in patch) body.film_aesthetic = patch.filmAesthetic;
    if ("revealAt" in patch) body.reveal_at = patch.revealAt ?? null;
    if ("eventEndsAt" in patch) body.event_ends_at = patch.eventEndsAt ?? null;
    if ("coverImageUrl" in patch) body.cover_image_url = patch.coverImageUrl ?? null;
    if ("slug" in patch) body.slug = patch.slug ?? null;
    return apiFetch<{ album: PhotoAlbum }>("PATCH", "/api/photo-albums/current", body);
  },

  /** Host-only: all uploads bypassing reveal lock. */
  listPhotos: (): Promise<{ uploads: FilmUpload[]; total: number }> =>
    apiFetch("GET", "/api/photo-albums/current/photos"),

  /** Host-only: participant list. */
  listDevices: (): Promise<{ devices: FilmDevice[]; total: number }> =>
    apiFetch("GET", "/api/photo-albums/current/devices"),

  /** Host-only: soft-remove a participant (#6). `purgePhotos` also hides their shots. */
  removeDevice: (
    deviceId: string,
    opts?: { purgePhotos?: boolean },
  ): Promise<{ removed: boolean; purgedCount: number }> => {
    const qs = opts?.purgePhotos ? "?purgePhotos=true" : "";
    return apiFetch(
      "DELETE",
      `/api/photo-albums/current/devices/${encodeURIComponent(deviceId)}${qs}`,
    );
  },

  // ── Public (no auth) ───────────────────────────────────────────────────────

  /** Public: fetch album metadata. */
  getPublic: (token: string): Promise<{ album: PhotoAlbumPublic }> =>
    publicFilmFetch<{ album: PhotoAlbumPublic }>(`/api/photo-albums/${token}`),

  /** Public: register guest device before any upload. */
  registerDevice(
    token: string,
    deviceId: string,
    guestName: string | null,
  ): Promise<{ album: PhotoAlbumPublic; shotCount: number }> {
    return publicFilmFetch<{ album: PhotoAlbumPublic; shotCount: number }>(
      `/api/photo-albums/${token}/devices`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: deviceId, guest_name: guestName }),
      },
    );
  },

  /** Public: reveal-locked photo list. */
  getPublicPhotos: (
    token: string,
  ): Promise<
    | { locked: true; revealsAt: number; photoCount: number }
    | { locked: false; uploads: unknown[]; total: number }
  > => publicFilmFetch(`/api/photo-albums/${token}/photos`),

  /** Public: upload a photo. Returns upload id + fileUrl + updated shotCount. */
  async upload(
    token: string,
    file: File,
    opts: { guestName?: string; deviceId: string; filterApplied?: FilmAesthetic },
  ): Promise<{ upload: { id: number; fileUrl: string }; shotCount: number }> {
    const form = new FormData();
    form.append("file", file);
    form.append("device_id", opts.deviceId);
    if (opts.guestName) form.append("guest_name", opts.guestName);
    if (opts.filterApplied) form.append("filter_applied", opts.filterApplied);
    return publicFilmFetch<{ upload: { id: number; fileUrl: string }; shotCount: number }>(
      `/api/photo-albums/${token}/photos`,
      { method: "POST", body: form },
    );
  },

  /** Authenticated: couple uploads their own photo to the film. */
  async uploadAsCouple(
    file: File,
    opts?: { filterApplied?: FilmAesthetic },
  ): Promise<{ upload: { id: number; fileUrl: string } }> {
    const form = new FormData();
    form.append("file", file);
    if (opts?.filterApplied) form.append("filter_applied", opts.filterApplied);
    const tok = getToken();
    const headers: Record<string, string> = tok ? { Authorization: `Bearer ${tok}` } : {};
    const res = await fetch("/api/photo-albums/current/photos", {
      method: "POST",
      headers,
      body: form,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let msg = "Upload failed";
      try {
        const p = JSON.parse(text) as { message?: string };
        if (p.message) msg = p.message;
      } catch {
        /* */
      }
      throw new Error(msg);
    }
    return res.json() as Promise<{ upload: { id: number; fileUrl: string } }>;
  },

  /** QR code SVG URL — embed directly in <img src> or open in new tab. */
  qrUrl: (token: string) => `/api/photo-albums/${token}/qr`,
};

/** Free official business-registry lookup (country-gated; see
 *  backend/src/lib/company_lookup). Unavailable countries get manual entry. */
export const companyLookupApi = {
  availability: (country: string) =>
    apiFetch<CompanyLookupAvailability>(
      "GET",
      `/api/company-lookup/availability?country=${encodeURIComponent(country)}`,
    ),
  search: (country: string, q: string) =>
    apiFetch<{ results: CompanyLookupResult[] }>(
      "GET",
      `/api/company-lookup/search?country=${encodeURIComponent(country)}&q=${encodeURIComponent(q)}`,
    ),
  getCompany: (country: string, id: string) =>
    apiFetch<{ company: CompanyLookupResult }>(
      "GET",
      `/api/company-lookup/company/${encodeURIComponent(id)}?country=${encodeURIComponent(country)}`,
    ),
};

/** Address autocomplete (backend proxy over the free Photon/OSM geocoder).
 *  Anonymous-allowed: the vendor signup form runs pre-account. */
export const geoApi = {
  /** `kind: "city"` narrows the geocoder to populated places, for fields that
   *  store a bare city name (vendor onboarding) rather than a street line. */
  addressSuggest: (q: string, lang: string, kind: "address" | "city" = "address") =>
    apiFetch<{ suggestions: AddressSuggestion[] }>(
      "GET",
      `/api/geo/address-suggest?q=${encodeURIComponent(q)}&lang=${encodeURIComponent(lang)}${
        kind === "city" ? "&kind=city" : ""
      }`,
    ),
  /** Reverse geocode a pin drop → { address, city } (either may be null). Used
   *  by the venue map picker to fill the address when the couple taps the map. */
  reverse: (lat: number, lng: number) =>
    apiFetch<{ address: string | null; city: string | null }>(
      "GET",
      `/api/geo/reverse?lat=${lat}&lng=${lng}`,
    ),
};

export const plannerApi = {
  listClients: () => apiFetch<{ clients: PlannerClientView[] }>("GET", "/api/planner/clients"),
  addClient: (email: string) =>
    apiFetch<{ ok: boolean; couple_id: number }>("POST", "/api/planner/clients", { email }),
  enterClient: (coupleId: number) =>
    apiFetch<{ couple: Couple }>("POST", `/api/planner/clients/${coupleId}/enter`, {}),
  exit: () => apiFetch<{ ok: boolean }>("POST", "/api/planner/exit", {}),
  updateNotes: (coupleId: number, notes: string) =>
    apiFetch<{ ok: boolean }>("PATCH", `/api/planner/clients/${coupleId}/notes`, { notes }),
  /** Hard-unlink a client: removes the planner↔couple link only, never the
   *  couple or their workspace data. */
  removeClient: (coupleId: number) =>
    apiFetch<{ ok: boolean }>("DELETE", `/api/planner/clients/${coupleId}`),
  listTasks: (includeDone = false) =>
    apiFetch<{ tasks: PlannerTaskRow[] }>(
      "GET",
      `/api/planner/tasks${includeDone ? "?include_done=1" : ""}`,
    ),
  /** Move a client task between kanban lanes ('todo'|'doing'|'done'); the
   *  backend keeps `done` in lockstep so the couple's checklist agrees. */
  updateTaskBoardStatus: (taskId: number, boardStatus: PlannerBoardStatus) =>
    apiFetch<{ ok: boolean; task_id: number; board_status: PlannerBoardStatus; done: boolean }>(
      "PATCH",
      `/api/planner/tasks/${taskId}`,
      { board_status: boardStatus },
    ),
  listInbox: () => apiFetch<{ threads: PlannerThreadPreview[] }>("GET", "/api/planner/messages"),
  listThread: (coupleId: number) =>
    apiFetch<{ messages: PlannerMessage[] }>("GET", `/api/planner/messages/${coupleId}`),
  sendMessage: (coupleId: number, subject: string, body_text: string, recipient_email: string) =>
    apiFetch<{ message: PlannerMessage }>("POST", `/api/planner/messages/${coupleId}`, {
      subject,
      body_text,
      recipient_email,
    }),
  getProfile: () => apiFetch<PlannerProfile>("GET", "/api/planner/profile"),
  updateProfile: (data: Partial<PlannerProfile>) =>
    apiFetch<PlannerProfile>("PATCH", "/api/planner/profile", data),
  /** Multipart avatar upload — JSON `apiFetch` can't speak FormData, so we hit
   *  fetch directly with the same Bearer header (mirrors vendor hero upload). */
  uploadAvatar: async (file: File): Promise<PlannerProfile> => {
    const form = new FormData();
    form.append("file", file);
    return uploadMultipart<PlannerProfile>("POST", "/api/planner/profile/avatar", form);
  },
  deleteAvatar: () => apiFetch<PlannerProfile>("DELETE", "/api/planner/profile/avatar"),
  addPortfolio: async (
    title: string,
    description: string,
    file: File | null,
  ): Promise<{ portfolio: PlannerPortfolioItem[] }> => {
    const form = new FormData();
    form.append("title", title);
    form.append("description", description);
    if (file) form.append("file", file);
    return uploadMultipart<{ portfolio: PlannerPortfolioItem[] }>(
      "POST",
      "/api/planner/profile/portfolio",
      form,
    );
  },
  deletePortfolio: (id: number) =>
    apiFetch<{ portfolio: PlannerPortfolioItem[] }>(
      "DELETE",
      `/api/planner/profile/portfolio/${id}`,
    ),
  /** Price offers / packages (árajánlat). Text fields are plain JSON; the
   *  optional PDF is a separate multipart call. The server enforces the max-3
   *  cap (409 `packages_full`) and every mutation returns the refreshed profile
   *  (with `packages`). Mirrors vendorListingApi.*Package. */
  addPackage: (body: { name: string; price_text?: string | null; description?: string | null }) =>
    apiFetch<PlannerProfile>("POST", "/api/planner/profile/packages", body),
  updatePackage: (
    packageId: number,
    body: { name?: string; price_text?: string | null; description?: string | null },
  ) => apiFetch<PlannerProfile>("PATCH", `/api/planner/profile/packages/${packageId}`, body),
  deletePackage: (packageId: number) =>
    apiFetch<PlannerProfile>("DELETE", `/api/planner/profile/packages/${packageId}`),
  uploadPackagePdf: (packageId: number, file: File): Promise<PlannerProfile> => {
    const form = new FormData();
    form.append("file", file);
    return uploadMultipart<PlannerProfile>(
      "POST",
      `/api/planner/profile/packages/${packageId}/pdf`,
      form,
    );
  },
  deletePackagePdf: (packageId: number) =>
    apiFetch<PlannerProfile>("DELETE", `/api/planner/profile/packages/${packageId}/pdf`),
  /** Availability (blocked dates). Whole-day only; every call returns the full
   *  refreshed view so the calendar re-renders from the server's truth. */
  getAvailability: () =>
    apiFetch<PlannerAvailabilityView>("GET", "/api/planner/profile/availability"),
  blockDate: (date: string, reason?: string) =>
    apiFetch<PlannerAvailabilityView>("POST", "/api/planner/profile/availability", {
      date,
      reason,
    }),
  unblockDate: (date: string) =>
    apiFetch<PlannerAvailabilityView>(
      "DELETE",
      `/api/planner/profile/availability?date=${encodeURIComponent(date)}`,
    ),
  listInvites: () => apiFetch<{ invites: PlannerInviteView[] }>("GET", "/api/planner/invites"),
  acceptInvite: (coupleId: number) =>
    apiFetch<{ ok: boolean }>("POST", `/api/planner/invites/${coupleId}/accept`, {}),
  declineInvite: (coupleId: number) =>
    apiFetch<{ ok: boolean }>("POST", `/api/planner/invites/${coupleId}/decline`, {}),
  /** Email invitations the planner has sent to not-yet-onboarded clients. */
  listInvitations: () =>
    apiFetch<{ invitations: PlannerInvitation[] }>("GET", "/api/planner/invitations"),
  /** Invite anyone by email. Returns kind:'request' when the email already had
   *  a workspace (a consent request was sent), or kind:'invite' for a fresh
   *  signup invitation. */
  createInvitation: (email: string) =>
    apiFetch<
      { kind: "request"; couple_id: number } | { kind: "invite"; invitation: PlannerInvitation }
    >("POST", "/api/planner/invitations", { email }),
  revokeInvitation: (id: number) =>
    apiFetch<{ ok: boolean }>("DELETE", `/api/planner/invitations/${id}`),
  /** Switch guest-page (vendégoldal) editing on/off for a client. Only succeeds
   *  (enable) once the couple has prepaid their 30% share (402 otherwise). */
  setGuestPageAccess: (coupleId: number, enabled: boolean) =>
    apiFetch<{ ok: boolean; guest_page_addon: boolean }>(
      "POST",
      `/api/planner/clients/${coupleId}/guest-page-access`,
      { enabled },
    ),
  stats: () => apiFetch<{ stats: PlannerStats }>("GET", "/api/planner/stats"),
  completeOnboarding: () =>
    apiFetch<{ ok: boolean }>("POST", "/api/planner/complete-onboarding", {}),
  /** Opt in to be notified when paid planner plans launch. Idempotent. */
  notifyPlans: () => apiFetch<{ ok: boolean }>("POST", "/api/planner/notify-plans", {}),
  // Calendar events
  listEvents: (from: string, to: string) =>
    apiFetch<{ events: PlannerEvent[] }>(
      "GET",
      `/api/planner/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),
  createEvent: (body: {
    title: string;
    event_date: string;
    start_time?: string | null;
    end_time?: string | null;
    couple_id?: number | null;
    notes?: string | null;
  }) => apiFetch<PlannerEvent>("POST", "/api/planner/events", body),
  updateEvent: (
    id: number,
    body: Partial<{
      title: string;
      event_date: string;
      start_time: string | null;
      end_time: string | null;
      couple_id: number | null;
      notes: string | null;
    }>,
  ) => apiFetch<PlannerEvent>("PATCH", `/api/planner/events/${id}`, body),
  deleteEvent: (id: number) => apiFetch<{ ok: boolean }>("DELETE", `/api/planner/events/${id}`),
  getClientCrm: (coupleId: number) =>
    apiFetch<PlannerClientCrm>("GET", `/api/planner/clients/${coupleId}/crm`),
  updateClientCrm: (coupleId: number, data: Partial<PlannerClientCrm>) =>
    apiFetch<{ ok: boolean }>("PATCH", `/api/planner/clients/${coupleId}/crm`, data),
  /** Timestamped private notes (comment feed) on one client, newest first. */
  listClientNotes: (coupleId: number) =>
    apiFetch<{ notes: PlannerClientNote[] }>("GET", `/api/planner/clients/${coupleId}/notes`),
  addClientNote: (coupleId: number, body: string) =>
    apiFetch<{ note: PlannerClientNote }>("POST", `/api/planner/clients/${coupleId}/notes`, {
      body,
    }),
  deleteClientNote: (coupleId: number, noteId: number) =>
    apiFetch<{ ok: boolean }>("DELETE", `/api/planner/clients/${coupleId}/notes/${noteId}`),
};

export const couplePlannerApi = {
  listPlanners: () => apiFetch<{ planners: LinkedPlannerView[] }>("GET", "/api/couples/planners"),
  /** Browsable planner directory for the /app/vendors rail. */
  directory: () =>
    apiFetch<{ planners: PlannerDirectoryEntry[] }>("GET", "/api/couples/planner-directory"),
  /** Batched directory analytics: card impressions + click-throughs. Fire-and-
   *  forget from the rail; a failed beacon never disrupts the couple. */
  recordCardEvents: (events: PlannerEventInput[]) =>
    apiFetch<{ recorded: number }>("POST", "/api/planners/events", { events }),
  /** Single-planner detail (opened from the card name): bio, references,
   *  availability, website, styles, portfolio + link_status for the CTA. */
  plannerDetail: (plannerUserId: number) =>
    apiFetch<PlannerDirectoryDetail>("GET", `/api/couples/planner-directory/${plannerUserId}`),
  invitePlanner: (email: string) =>
    apiFetch<{ ok: boolean }>("POST", "/api/couples/planner-invite", { planner_email: email }),
  /** Directory-rail variant — the rail never sees planner emails. */
  invitePlannerById: (plannerUserId: number) =>
    apiFetch<{ ok: boolean }>("POST", "/api/couples/planner-invite", {
      planner_user_id: plannerUserId,
    }),
  /** Approve a planner-initiated access request (status pending,
   *  initiated_by 'planner'). Flips it to active so the planner can enter. */
  acceptPlanner: (plannerUserId: number) =>
    apiFetch<{ ok: boolean }>("POST", `/api/couples/planners/${plannerUserId}/accept`, {}),
  revokePlanner: (plannerUserId: number) =>
    apiFetch<{ ok: boolean }>("DELETE", `/api/couples/planners/${plannerUserId}`),
};

/** Public: resolve who invited you from a planner email-invitation token, so
 *  the signup page can show "<Planner> invited you" before you register. */
export const plannerInviteApi = {
  lookup: (token: string) =>
    apiFetch<PlannerInvitePublic>("GET", `/api/planner-invites/${encodeURIComponent(token)}`),
};

/** Browser-only growth signals (POST /api/growth/event). The server rejects any
 *  kind outside `FRONTEND_GROWTH_EVENT_KINDS`, so this is a narrow door, not a
 *  general telemetry pipe. */
export const growthApi = {
  /** Fire-and-forget: instrumentation must never surface an error to the user
   *  or block the interaction it is measuring, so the caller gets a promise
   *  that always resolves. */
  record: (kind: GrowthEventKind, payload?: Record<string, unknown>): Promise<void> =>
    apiFetch<{ recorded: number }>("POST", "/api/growth/event", { kind, payload })
      .then(() => undefined)
      .catch(() => undefined),
};
