import { lazy, Suspense, type JSX, type ReactNode, useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { VerifyEmailGate } from "./components/VerifyEmailGate";
import { useAuth } from "./lib/auth";
import { clearDemoSessionFlag, isCurrentSessionDemo } from "./lib/demoSession";

// Public routes are eagerly imported — they're FCP-critical and small in
// aggregate. The signed-in /app/* and admin/* areas, plus low-traffic
// flows (rsvp, onboarding, invite-by-token, reset-password), are lazy so
// they never ship in the landing-page first paint. Before this split the
// public bundle was ~1.4 MB; the admin + planning + seating + timeline
// + suppliers + leaflet code lived there even for an unauthenticated
// visitor browsing /. After: only public components ship in the entry
// chunk, the rest streams in when a session lands on /app.
import AboutPage from "./pages/AboutPage";
import BlogIndexPage from "./pages/BlogIndexPage";
import BlogPostPage from "./pages/BlogPostPage";
import BudgetCalculatorPage from "./pages/BudgetCalculatorPage";
import CountdownPage from "./pages/CountdownPage";
import CoupleCardsPage from "./pages/CoupleCardsPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import GuestListTemplatePage from "./pages/GuestListTemplatePage";
import RsvpGeneratorPage from "./pages/RsvpGeneratorPage";
import SeatingChartPage from "./pages/SeatingChartPage";
import ImprintPage from "./pages/ImprintPage";
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import NotFoundPage from "./pages/NotFoundPage";
import PrivacyPage from "./pages/PrivacyPage";
import RegisterPage from "./pages/RegisterPage";
import SubscriptionTermsPage from "./pages/SubscriptionTermsPage";
import TermsPage from "./pages/TermsPage";
import VendorsPage from "./pages/VendorsPage";
import PlannersPage from "./pages/PlannersPage";

const AppShellLayout = lazy(() =>
  import("./components/AppShell").then((m) => ({ default: m.AppShellLayout })),
);
const AdminAnalyticsPage = lazy(() => import("./pages/AdminAnalyticsPage"));
const AdminEmailPreviewPage = lazy(() =>
  import("./pages/AdminEmailPreviewPage").then((m) => ({ default: m.AdminEmailPreviewPage })),
);
const AdminFinancialPlannerPage = lazy(() => import("./pages/AdminFinancialPlannerPage"));
const AdminBlogPage = lazy(() => import("./pages/AdminBlogPage"));
const AdminCoupleCardsPage = lazy(() => import("./pages/AdminCoupleCardsPage"));
const AdminFeedbackPage = lazy(() => import("./pages/AdminFeedbackPage"));
const AdminCategoriesPage = lazy(() => import("./pages/AdminCategoriesPage"));
const AdminSuppliersPage = lazy(() => import("./pages/AdminSuppliersPage"));
const AdminUsersPage = lazy(() => import("./pages/AdminUsersPage"));
const AdminVendorsPage = lazy(() => import("./pages/AdminVendorsPage"));
const AdminPlannersPage = lazy(() => import("./pages/AdminPlannersPage"));
const AdminVendorWaitlistPage = lazy(() => import("./pages/AdminVendorWaitlistPage"));
const AdminPlannerWaitlistPage = lazy(() => import("./pages/AdminPlannerWaitlistPage"));
const AdminEmailListPage = lazy(() => import("./pages/AdminEmailListPage"));
const BudgetPage = lazy(() => import("./pages/BudgetPage"));
const ChangeEmailPage = lazy(() => import("./pages/ChangeEmailPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const DesignPage = lazy(() => import("./pages/DesignPage"));
const GuestPageEditorPage = lazy(() => import("./pages/GuestPageEditorPage"));
const GuestsPage = lazy(() => import("./pages/GuestsPage"));
const GuestInvitesPage = lazy(() => import("./pages/GuestInvitesPage"));
const HoneymoonPage = lazy(() => import("./pages/HoneymoonPage"));
const InvitePage = lazy(() => import("./pages/InvitePage"));
const LogisticsPage = lazy(() => import("./pages/LogisticsPage"));
const MediaPage = lazy(() => import("./pages/MediaPage"));
const MoodboardPage = lazy(() => import("./pages/MoodboardPage"));
const OnboardingWizard = lazy(() => import("./pages/OnboardingWizard"));
const PlanningPage = lazy(() => import("./pages/PlanningPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const SettingsLayout = lazy(() => import("./pages/SettingsLayout"));
const BillingSettings = lazy(() => import("./pages/BillingSettings"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const GuestPhotoPage = lazy(() => import("./pages/GuestPhotoPage"));
const RsvpCheckinPage = lazy(() => import("./pages/RsvpCheckinPage"));
const RsvpPage = lazy(() => import("./pages/RsvpPage"));
const SchedulePage = lazy(() => import("./pages/SchedulePage"));
const SeatingPage = lazy(() => import("./pages/SeatingPage"));
const SuppliersPage = lazy(() => import("./pages/SuppliersPage"));
const SupplierDetailPage = lazy(() => import("./pages/SupplierDetailPage"));
const TimelinePage = lazy(() => import("./pages/TimelinePage"));
const VerifyEmailPage = lazy(() => import("./pages/VerifyEmailPage"));
const VendorClaimVerifyPage = lazy(() => import("./pages/VendorClaimVerifyPage"));
const VendorActivatePage = lazy(() => import("./pages/VendorActivatePage"));
const VendorRegisterPage = lazy(() => import("./pages/VendorRegisterPage"));
const VendorOnboardingPage = lazy(() => import("./pages/vendor/VendorOnboardingPage"));
// VendorHomePage (pages/VendorHomePage.tsx) is the legacy standalone listing
// editor — its body will be lifted into the in-shell VendorListingPage by a
// feature agent, so it's no longer routed directly here.
const VendorShellLayout = lazy(() =>
  import("./components/VendorShell").then((m) => ({ default: m.VendorShellLayout })),
);
const VendorDashboardPage = lazy(() => import("./pages/vendor/VendorDashboardPage"));
const VendorClientsPage = lazy(() => import("./pages/vendor/VendorClientsPage"));
const VendorClientDetailPage = lazy(() => import("./pages/vendor/VendorClientDetailPage"));
const VendorListingPage = lazy(() => import("./pages/vendor/VendorListingPage"));
const VendorStatsPage = lazy(() => import("./pages/vendor/VendorStatsPage"));
const VendorBillingPage = lazy(() => import("./pages/vendor/VendorBillingPage"));
const VendorSettingsPage = lazy(() => import("./pages/vendor/VendorSettingsPage"));
const VerifySupplierPage = lazy(() => import("./pages/VerifySupplierPage"));
const WeddingWebsitePage = lazy(() => import("./pages/WeddingWebsitePage"));
const WishlistEditorPage = lazy(() => import("./pages/WishlistEditorPage"));
const PlannerShellLayout = lazy(() =>
  import("./components/PlannerShell").then((m) => ({ default: m.PlannerShellLayout })),
);
const PlannerHomePage = lazy(() => import("./pages/PlannerHomePage"));
const PlannerClientsPage = lazy(() => import("./pages/planner/PlannerClientsPage"));
const PlannerCalendarPage = lazy(() => import("./pages/planner/PlannerCalendarPage"));
const PlannerStatsPage = lazy(() => import("./pages/planner/PlannerStatsPage"));
const PlannerOnboardingPage = lazy(() => import("./pages/PlannerOnboardingPage"));
const PlannerMessagesPage = lazy(() => import("./pages/PlannerMessagesPage"));
const PlannerProfilePage = lazy(() => import("./pages/PlannerProfilePage"));
const PlannerSettingsLayout = lazy(() => import("./pages/planner/PlannerSettingsLayout"));
const PlannerSettingsAccount = lazy(() => import("./pages/planner/PlannerSettingsAccount"));
const PlannerSettingsSubscription = lazy(
  () => import("./pages/planner/PlannerSettingsSubscription"),
);
const PlannerSettingsData = lazy(() => import("./pages/planner/PlannerSettingsData"));
const PlannerBillingPage = lazy(() => import("./pages/planner/PlannerBillingPage"));
const PlannerClientPage = lazy(() => import("./pages/planner/PlannerClientPage"));

// Session-storage flag set by VerifyEmailGate when the user opts into the
// "continue with limited access" path. Lets the gate downgrade to an
// in-AppShell banner so the user can poke around the workspace structure
// while still being blocked at the backend by `requireVerifiedAuth` on
// write endpoints. The flag is session-scoped on purpose — a tab reload
// after verification clears it, and a hard logout/login also clears.
const VERIFY_BYPASS_SESSION_KEY = "weddly.verify.bypass";
function verifyBypassed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(VERIFY_BYPASS_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.verified_email && !verifyBypassed()) {
    return <VerifyEmailGate email={user.email} />;
  }
  return children;
}

function RequireAdmin({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user && !user.is_admin) return <Navigate to="/app" replace />;
  // Admin surface rides the landing's General Sans voice (`font-grotesk`)
  // rather than the app's default Inter, per user direction 2026-06-02.
  return <div className="font-grotesk">{children}</div>;
}

// Like RequireAuth but also gates out planner accounts — they get redirected
// to /app/planner so they don't land inside the couple workspace by accident.
function RequireCoupleAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  // Vendors have their own workspace at /vendor — never the couple /app shell.
  if (user.role === "vendor") return <Navigate to="/vendor" replace />;
  // Planners with an active client couple (couple_id set) are allowed through;
  // planners with no active client bounce to their own dashboard.
  if (user.user_type === "planner" && !user.couple_id)
    return <Navigate to="/app/planner" replace />;
  if (!user.verified_email && !verifyBypassed()) {
    return <VerifyEmailGate email={user.email} />;
  }
  return children;
}

// Gate for the vendor workspace (/vendor/*). Vendor role only — anyone else is
// bounced to the couple /app (which itself re-routes planners). Unverified
// vendors hit the same VerifyEmailGate as couples.
function RequireVendorAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "vendor") return <Navigate to="/app" replace />;
  if (!user.verified_email && !verifyBypassed()) {
    return <VerifyEmailGate email={user.email} />;
  }
  return children;
}

// Lighter vendor gate for the post-signup onboarding wizard: role only, NO
// verify gate — a fresh self-serve vendor should be able to finish onboarding
// before clicking the verification email (mirrors couples reaching /onboarding
// pre-verification). The wizard's own load redirects to /vendor if already done.
function RequireVendorRole({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "vendor") return <Navigate to="/app" replace />;
  return children;
}

/** Legacy `/g/:slug/:code` → `/w/:slug/:code`. The merged Vendégoldal
 *  endpoint now serves both audiences (anonymous + invited + confirmed)
 *  from a single React component, so we forward old guest-portal links
 *  to the unified surface. `replace` so the back button doesn't bounce. */
function GuestPageRedirect() {
  const { slug = "", code = "" } = useParams<{ slug: string; code: string }>();
  return <Navigate to={`/w/${encodeURIComponent(slug)}/${encodeURIComponent(code)}`} replace />;
}

/** Legacy `/register` → `/signup`. Planner invite emails and referral share
 *  links minted before 2026-07 pointed at /register, which never existed as a
 *  route. Keep the query string (`?planner_invite=`, `?ref_code=`) so those
 *  links still land on a working signup. */
function RegisterRedirect() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: "/signup", search }} replace />;
}

/** Legacy `/app/dashboard` → `/app` (the dashboard is the index route),
 *  keeping the `#invite-partner` anchor from old reminder emails. */
function DashboardLegacyRedirect() {
  const { hash } = useLocation();
  return <Navigate to={{ pathname: "/app", hash }} replace />;
}

/** Visible unsubscribe links in lifecycle emails point at
 *  `/unsubscribe/<token>`. In production the backend router serves that path
 *  directly (before the SPA fallback); this route only exists so the dev
 *  server — where Vite owns the origin — forwards to the proxied API. */
function UnsubscribeRedirect() {
  const { token = "" } = useParams<{ token: string }>();
  useEffect(() => {
    window.location.replace(`/api/unsubscribe/${encodeURIComponent(token)}`);
  }, [token]);
  return <FullScreenLoader />;
}

export function RedirectIfAuthed({ children }: { children: JSX.Element }) {
  const { user, loading, logout } = useAuth();
  // A live *demo* session must never block the auth forms. The throwaway
  // Shrek & Fiona session is "authed" from React's point of view, so a
  // visitor who launched the demo and then lands on /signup or /login by any
  // route other than the in-overlay convert button (a header link, a typed
  // URL, the back button) would otherwise be bounced straight back into the
  // demo workspace at /app — i.e. "registration just shows the demo". Treat
  // arriving here with a demo session as intent to convert: tear the demo
  // down and render the form. Real sessions still bounce to /app.
  const demoSession = isCurrentSessionDemo();
  useEffect(() => {
    if (user && demoSession) {
      clearDemoSessionFlag();
      void logout();
    }
  }, [user, demoSession, logout]);
  if (loading) return <FullScreenLoader />;
  if (user && !demoSession) {
    const dest =
      user.role === "vendor" ? "/vendor" : user.user_type === "planner" ? "/app/planner" : "/app";
    return <Navigate to={dest} replace />;
  }
  return children;
}

function FullScreenLoader() {
  return (
    <div className="flex h-full items-center justify-center text-ink-500 text-sm">Loading…</div>
  );
}

// Per-route boundary so a render error in one page doesn't take down the
// whole app — the user can navigate to a sibling route via the fallback's
// "Go to home" link without a full reload. Suspense wraps the children so
// lazy()-d chunks render the loader during their network fetch.
function Page({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<FullScreenLoader />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

/** Scroll the viewport to the top on every client-side route change.
 *  Without this, navigating from a long landing page (or the bottom of a
 *  /blog post) into another route preserves the previous scroll position,
 *  which the user reads as "the page is broken". Honours anchor links so
 *  `#section` jumps still land on the intended target. */
function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) return;
    window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route
          path="/"
          element={
            <Page>
              <LandingPage />
            </Page>
          }
        />
        <Route
          path="/vendors"
          element={
            <Page>
              <VendorsPage />
            </Page>
          }
        />
        <Route
          path="/vendors/signup"
          element={
            <RedirectIfAuthed>
              <Page>
                <VendorRegisterPage />
              </Page>
            </RedirectIfAuthed>
          }
        />
        <Route
          path="/planners"
          element={
            <Page>
              <PlannersPage />
            </Page>
          }
        />
        <Route path="/planner" element={<Navigate to="/planners" replace />} />
        {/* SEO tool pages mounted at /eszkozok/* (HU) and /tools/* (EN).
         *  Each slug pair targets a long-tail search query in its locale and
         *  shares the bilingual ROUTE_SEO entry — the visitor's locale picks
         *  the copy that renders. The hreflang link rel in seo_ssr.ts pairs
         *  the two slugs so Google indexes them as alternates of each other
         *  on the multi-host weddly.hu ↔ weddly.com setup. */}
        <Route
          path="/eszkozok/eskuvo-koltsegvetes-kalkulator"
          element={
            <Page>
              <BudgetCalculatorPage />
            </Page>
          }
        />
        <Route
          path="/tools/wedding-budget-calculator"
          element={
            <Page>
              <BudgetCalculatorPage />
            </Page>
          }
        />
        <Route
          path="/eszkozok/eskuvo-visszaszamlalo"
          element={
            <Page>
              <CountdownPage />
            </Page>
          }
        />
        <Route
          path="/tools/wedding-countdown"
          element={
            <Page>
              <CountdownPage />
            </Page>
          }
        />
        <Route
          path="/eszkozok/vendeglista-sablon"
          element={
            <Page>
              <GuestListTemplatePage />
            </Page>
          }
        />
        <Route
          path="/tools/guest-list-template"
          element={
            <Page>
              <GuestListTemplatePage />
            </Page>
          }
        />
        <Route
          path="/eszkozok/ultetesi-rend-keszito"
          element={
            <Page>
              <SeatingChartPage />
            </Page>
          }
        />
        <Route
          path="/tools/seating-chart-builder"
          element={
            <Page>
              <SeatingChartPage />
            </Page>
          }
        />
        <Route
          path="/eszkozok/rsvp-szoveg-generator"
          element={
            <Page>
              <RsvpGeneratorPage />
            </Page>
          }
        />
        <Route
          path="/tools/rsvp-text-generator"
          element={
            <Page>
              <RsvpGeneratorPage />
            </Page>
          }
        />
        <Route
          path="/eszkozok/100-kerdes-eskuvo-elott"
          element={
            <Page>
              <CoupleCardsPage />
            </Page>
          }
        />
        <Route
          path="/tools/100-questions-before-marriage"
          element={
            <Page>
              <CoupleCardsPage />
            </Page>
          }
        />
        <Route
          path="/privacy"
          element={
            <Page>
              <PrivacyPage />
            </Page>
          }
        />
        <Route
          path="/terms"
          element={
            <Page>
              <TermsPage />
            </Page>
          }
        />
        <Route
          path="/terms/vendor-subscription"
          element={
            <Page>
              <SubscriptionTermsPage />
            </Page>
          }
        />
        <Route
          path="/about"
          element={
            <Page>
              <AboutPage />
            </Page>
          }
        />
        <Route
          path="/blog"
          element={
            <Page>
              <BlogIndexPage />
            </Page>
          }
        />
        <Route
          path="/blog/:slug"
          element={
            <Page>
              <BlogPostPage />
            </Page>
          }
        />
        <Route
          path="/impresszum"
          element={
            <Page>
              <ImprintPage />
            </Page>
          }
        />
        {/* English alias — same component, different URL. Lets EN users
          find the page when they search for "imprint". */}
        <Route
          path="/imprint"
          element={
            <Page>
              <ImprintPage />
            </Page>
          }
        />
        <Route
          path="/login"
          element={
            <Page>
              <RedirectIfAuthed>
                <LoginPage />
              </RedirectIfAuthed>
            </Page>
          }
        />
        <Route path="/register" element={<RegisterRedirect />} />
        <Route path="/unsubscribe/:token" element={<UnsubscribeRedirect />} />
        {/* Post-wedding follow-up emails sent before 2026-07 linked here. */}
        <Route path="/feedback" element={<Navigate to="/app?feedback=1" replace />} />
        <Route
          path="/signup"
          element={
            <Page>
              <RedirectIfAuthed>
                <RegisterPage />
              </RedirectIfAuthed>
            </Page>
          }
        />
        <Route
          path="/forgot-password"
          element={
            <Page>
              <ForgotPasswordPage />
            </Page>
          }
        />
        <Route
          path="/reset-password/:token"
          element={
            <Page>
              <ResetPasswordPage />
            </Page>
          }
        />
        <Route
          path="/verify-email/:token"
          element={
            <Page>
              <VerifyEmailPage />
            </Page>
          }
        />
        <Route
          path="/verify-supplier/:token"
          element={
            <Page>
              <VerifySupplierPage />
            </Page>
          }
        />
        <Route
          path="/vendor/claim/verify/:token"
          element={
            <Page>
              <VendorClaimVerifyPage />
            </Page>
          }
        />
        {/* Accepted-waitlist invite link. The admin "accept" decision mints a
            single-use onboarding token and emails this URL; the page reads the
            token (verify) to prefill the vendor's submitted details, then
            completes into a live vendor account + session. Public + outside the
            vendor shell (the vendor has no account yet). */}
        <Route
          path="/vendor/activate/:token"
          element={
            <Page>
              <VendorActivatePage />
            </Page>
          }
        />
        {/* Post-signup onboarding wizard — outside the VendorShell, role-only
            gate (no verify gate) so a fresh vendor can finish it immediately. */}
        <Route
          path="/vendor/onboarding"
          element={
            <RequireVendorRole>
              <Page>
                <VendorOnboardingPage />
              </Page>
            </RequireVendorRole>
          }
        />
        {/* Vendor workspace — its own shell tree, gated to role='vendor'.
            The public token routes /vendor/activate/:token and
            /vendor/claim/verify/:token are declared ABOVE and stay outside
            the shell. Like /app, one mounted VendorShellLayout keeps the
            header + nav alive across vendor navigation. */}
        <Route
          path="/vendor"
          element={
            <RequireVendorAuth>
              <Suspense fallback={<FullScreenLoader />}>
                <VendorShellLayout />
              </Suspense>
            </RequireVendorAuth>
          }
        >
          <Route
            index
            element={
              <Page>
                <VendorDashboardPage />
              </Page>
            }
          />
          <Route
            path="clients"
            element={
              <Page>
                <VendorClientsPage />
              </Page>
            }
          />
          <Route
            path="clients/:id"
            element={
              <Page>
                <VendorClientDetailPage />
              </Page>
            }
          />
          <Route
            path="listing"
            element={
              <Page>
                <VendorListingPage />
              </Page>
            }
          />
          <Route
            path="stats"
            element={
              <Page>
                <VendorStatsPage />
              </Page>
            }
          />
          <Route
            path="billing"
            element={
              <Page>
                <VendorBillingPage />
              </Page>
            }
          />
          <Route
            path="settings"
            element={
              <Page>
                <VendorSettingsPage />
              </Page>
            }
          />
        </Route>
        <Route
          path="/change-email/:token"
          element={
            <Page>
              <ChangeEmailPage />
            </Page>
          }
        />
        <Route
          path="/invite/:token"
          element={
            <Page>
              <InvitePage />
            </Page>
          }
        />
        <Route
          path="/rsvp"
          element={
            <Page>
              <RsvpCheckinPage />
            </Page>
          }
        />
        <Route
          path="/photos/:token"
          element={
            <Page>
              <GuestPhotoPage />
            </Page>
          }
        />
        <Route
          path="/rsvp/:code"
          element={
            <Page>
              <RsvpPage />
            </Page>
          }
        />
        {/* Legacy `/g/:slug/:code` redirects into the merged
         *  `/w/:slug/:code` so personalised links keep working. The
         *  unified WeddingWebsitePage handles every tier (public,
         *  invited, confirmed) in-place — see Phase 2 of the
         *  Vendégoldal merger. */}
        <Route path="/g/:slug/:code" element={<GuestPageRedirect />} />
        <Route
          path="/w/:slug"
          element={
            <Page>
              <WeddingWebsitePage />
            </Page>
          }
        />
        <Route
          path="/w/:slug/:code"
          element={
            <Page>
              <WeddingWebsitePage />
            </Page>
          }
        />
        <Route
          path="/onboarding"
          element={
            <Page>
              <RequireAuth>
                <OnboardingWizard />
              </RequireAuth>
            </Page>
          }
        />
        {/* Guest invitations + communication center. Declared as a SIBLING of
         *  /app (higher route specificity than the /app parent) so it renders
         *  full-screen WITHOUT the AppShell sidebar — same shape as
         *  /app/planner/onboarding. Not in AppShell ITEMS, so no nav entry. */}
        <Route
          path="/app/invites"
          element={
            <RequireCoupleAuth>
              <Page>
                <GuestInvitesPage />
              </Page>
            </RequireCoupleAuth>
          }
        />
        {/* All /app/* routes share one mounted AppShellLayout — the parent
         *  Route element renders <AppShell> + <Outlet/>, so the sidebar,
         *  header, and WorkspaceSwitcher stay alive across navigation. Per-
         *  child `<Page>` wrapper keeps the ErrorBoundary per-route so a
         *  render error in one page doesn't unmount the whole shell. */}
        <Route
          path="/app"
          element={
            <RequireCoupleAuth>
              <Suspense fallback={<FullScreenLoader />}>
                <AppShellLayout />
              </Suspense>
            </RequireCoupleAuth>
          }
        >
          <Route
            index
            element={
              <Page>
                <DashboardPage />
              </Page>
            }
          />
          {/* Legacy email links: partner-invite reminders sent before 2026-07
           *  pointed at /app/dashboard#invite-partner; the dashboard is the
           *  /app index. Keep the hash so the anchor still lands. */}
          <Route path="dashboard" element={<DashboardLegacyRedirect />} />
          {/* Admin digest emails link to /app/admin; land on the first
           *  moderation surface instead of the 404 page. */}
          <Route path="admin" element={<Navigate to="/app/admin/suppliers" replace />} />
          <Route
            path="guests"
            element={
              <Page>
                <GuestsPage />
              </Page>
            }
          />
          <Route
            path="budget"
            element={
              <Page>
                <BudgetPage />
              </Page>
            }
          />
          <Route
            path="seating"
            element={
              <Page>
                <SeatingPage />
              </Page>
            }
          />
          <Route
            path="logistics"
            element={
              <Page>
                <LogisticsPage />
              </Page>
            }
          />
          <Route
            path="schedule"
            element={
              <Page>
                <SchedulePage />
              </Page>
            }
          />
          <Route
            path="timeline"
            element={
              <Page>
                <TimelinePage />
              </Page>
            }
          />
          {/* Canonical path is now `/app/vendors` (matches the public
            `/vendors` route + the new vendor_accounts/listings model
            landed in 3b08afb). The legacy `/app/suppliers` still mounts
            the same page so external links keep working until we replace
            it with a redirect. */}
          <Route
            path="vendors"
            element={
              <Page>
                <SuppliersPage />
              </Page>
            }
          />
          <Route path="suppliers" element={<Navigate to="/app/vendors" replace />} />
          {/* Outreach Inbox now lives as a section on /app/vendors — the
            legacy URL keeps redirecting so emailed deep-links + bookmarks
            still land on the same workspace. */}
          <Route path="outreach" element={<Navigate to="/app/vendors" replace />} />
          <Route
            path="planning"
            element={
              <Page>
                <PlanningPage />
              </Page>
            }
          />
          <Route
            path="honeymoon"
            element={
              <Page>
                <HoneymoonPage />
              </Page>
            }
          />
          <Route
            path="wishlist"
            element={
              <Page>
                <WishlistEditorPage />
              </Page>
            }
          />
          <Route
            path="guest-page"
            element={
              <Page>
                <GuestPageEditorPage />
              </Page>
            }
          />
          {/* Legacy URLs from the older split — redirect into the merged
           *  /app/guest-page so existing bookmarks and external links keep
           *  resolving for at least one release after the merger. */}
          <Route path="guest-portal" element={<Navigate to="/app/guest-page" replace />} />
          <Route path="wedding-site" element={<Navigate to="/app/guest-page" replace />} />
          <Route
            path="moodboard"
            element={
              <Page>
                <MoodboardPage />
              </Page>
            }
          />
          {/* Design splits into two sub-pages — guest website vs printable
              cards — sharing DesignPage's state + auto-save (the surface is
              derived from the URL). /app/design redirects to the website tab. */}
          <Route path="design" element={<Navigate to="/app/design/website" replace />} />
          <Route
            path="design/website"
            element={
              <Page>
                <DesignPage />
              </Page>
            }
          />
          <Route
            path="design/print"
            element={
              <Page>
                <DesignPage />
              </Page>
            }
          />
          <Route
            path="media"
            element={
              <Page>
                <MediaPage />
              </Page>
            }
          />
          {/* Legacy /app/profile route — redirects to the new Settings hub.
            Kept so any bookmarks, emailed deep-links, or old in-app
            references (ProfileMenu, WorkspaceSwitcher) keep landing
            users on a working page during the transition window. */}
          <Route path="profile" element={<Navigate to="/app/settings/account" replace />} />
          <Route
            path="settings"
            element={
              <Page>
                <SettingsLayout />
              </Page>
            }
          >
            <Route index element={<Navigate to="account" replace />} />
            <Route path="account" element={<ProfilePage tab="account" />} />
            <Route path="workspace" element={<ProfilePage tab="workspace" />} />
            <Route path="planning" element={<ProfilePage tab="planning" />} />
            <Route path="billing" element={<BillingSettings />} />
            <Route path="data" element={<ProfilePage tab="data" />} />
          </Route>
          <Route
            path="admin/suppliers"
            element={
              <Page>
                <RequireAdmin>
                  <AdminSuppliersPage />
                </RequireAdmin>
              </Page>
            }
          />
          <Route
            path="suppliers/:supplier_id"
            element={
              <Page>
                <RequireAuth>
                  <SupplierDetailPage />
                </RequireAuth>
              </Page>
            }
          />
          <Route
            path="admin/users"
            element={
              <Page>
                <RequireAdmin>
                  <AdminUsersPage />
                </RequireAdmin>
              </Page>
            }
          />
          <Route
            path="admin/vendors"
            element={
              <Page>
                <RequireAdmin>
                  <AdminVendorsPage />
                </RequireAdmin>
              </Page>
            }
          />
          <Route
            path="admin/planners"
            element={
              <Page>
                <RequireAdmin>
                  <AdminPlannersPage />
                </RequireAdmin>
              </Page>
            }
          />
          <Route
            path="admin/categories"
            element={
              <Page>
                <RequireAdmin>
                  <AdminCategoriesPage />
                </RequireAdmin>
              </Page>
            }
          />
          <Route
            path="admin/vendor-waitlist"
            element={
              <Page>
                <RequireAdmin>
                  <AdminVendorWaitlistPage />
                </RequireAdmin>
              </Page>
            }
          />
          <Route
            path="admin/planner-waitlist"
            element={
              <Page>
                <RequireAdmin>
                  <AdminPlannerWaitlistPage />
                </RequireAdmin>
              </Page>
            }
          />
          <Route
            path="admin/feedback"
            element={
              <Page>
                <RequireAdmin>
                  <AdminFeedbackPage />
                </RequireAdmin>
              </Page>
            }
          />
          <Route
            path="admin/couple-cards"
            element={
              <Page>
                <RequireAdmin>
                  <AdminCoupleCardsPage />
                </RequireAdmin>
              </Page>
            }
          />
          <Route
            path="admin/blog"
            element={
              <Page>
                <RequireAdmin>
                  <AdminBlogPage />
                </RequireAdmin>
              </Page>
            }
          />
          <Route
            path="admin/analytics"
            element={
              <Page>
                <RequireAdmin>
                  <AdminAnalyticsPage />
                </RequireAdmin>
              </Page>
            }
          />
          <Route
            path="admin/email-preview"
            element={
              <Page>
                <RequireAdmin>
                  <AdminEmailPreviewPage />
                </RequireAdmin>
              </Page>
            }
          />
          <Route
            path="admin/financial-planner"
            element={
              <Page>
                <RequireAdmin>
                  <AdminFinancialPlannerPage />
                </RequireAdmin>
              </Page>
            }
          />
          <Route
            path="admin/email-list"
            element={
              <Page>
                <RequireAdmin>
                  <AdminEmailListPage />
                </RequireAdmin>
              </Page>
            }
          />
        </Route>
        {/* Planner workspace — separate route tree from the couple /app.
            RequireAuth only (planners must log in and verify email);
            RequireCoupleAuth is not used here because planners ARE the
            intended audience. The shell and features are a stub for Phase 1;
            deeper planner-specific navigation lands in Phase 2. */}
        {/* Planner onboarding wizard — OUTSIDE the shell (full-screen, no nav). */}
        <Route
          path="/app/planner/onboarding"
          element={
            <RequireAuth>
              <Page>
                <PlannerOnboardingPage />
              </Page>
            </RequireAuth>
          }
        />
        {/* Planner workspace — one mounted PlannerShellLayout keeps the header +
            left nav alive across planner navigation; child pages are content-only. */}
        <Route
          path="/app/planner"
          element={
            <RequireAuth>
              <Suspense fallback={<FullScreenLoader />}>
                <PlannerShellLayout />
              </Suspense>
            </RequireAuth>
          }
        >
          <Route
            index
            element={
              <Page>
                <PlannerHomePage />
              </Page>
            }
          />
          <Route
            path="clients"
            element={
              <Page>
                <PlannerClientsPage />
              </Page>
            }
          />
          <Route
            path="clients/:coupleId"
            element={
              <Page>
                <PlannerClientPage />
              </Page>
            }
          />
          <Route
            path="calendar"
            element={
              <Page>
                <PlannerCalendarPage />
              </Page>
            }
          />
          <Route
            path="stats"
            element={
              <Page>
                <PlannerStatsPage />
              </Page>
            }
          />
          <Route
            path="messages"
            element={
              <Page>
                <PlannerMessagesPage />
              </Page>
            }
          />
          <Route
            path="messages/:coupleId"
            element={
              <Page>
                <PlannerMessagesPage />
              </Page>
            }
          />
          <Route
            path="billing"
            element={
              <Page>
                <PlannerBillingPage />
              </Page>
            }
          />
          <Route path="profile" element={<Navigate to="/app/planner/settings/account" replace />} />
          {/* Legacy/guessed dashboard aliases land on the dashboard instead of a 404. */}
          <Route path="overview" element={<Navigate to="/app/planner" replace />} />
          <Route path="dashboard" element={<Navigate to="/app/planner" replace />} />
          <Route path="settings" element={<PlannerSettingsLayout />}>
            <Route index element={<Navigate to="account" replace />} />
            <Route path="account" element={<PlannerSettingsAccount />} />
            <Route path="subscription" element={<PlannerSettingsSubscription />} />
            <Route path="data" element={<PlannerSettingsData />} />
          </Route>
          {/* Unknown planner paths keep the planner chrome (sidebar + header)
              so the user doesn't lose app context on a bad link. */}
          <Route
            path="*"
            element={
              <Page>
                <NotFoundPage bare homeTo="/app/planner" />
              </Page>
            }
          />
        </Route>
        <Route
          path="*"
          element={
            <Page>
              <NotFoundPage />
            </Page>
          }
        />
      </Routes>
    </>
  );
}
