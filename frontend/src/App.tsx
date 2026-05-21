import { lazy, Suspense, type JSX, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { VerifyEmailGate } from "./components/VerifyEmailGate";
import { useAuth } from "./lib/auth";

// Public routes are eagerly imported — they're FCP-critical and small in
// aggregate. The signed-in /app/* and admin/* areas, plus low-traffic
// flows (rsvp, onboarding, invite-by-token, reset-password), are lazy so
// they never ship in the landing-page first paint. Before this split the
// public bundle was ~1.4 MB; the admin + planning + seating + timeline
// + suppliers + leaflet code lived there even for an unauthenticated
// visitor browsing /. After: only public components ship in the entry
// chunk, the rest streams in when a session lands on /app.
import AboutPage from "./pages/AboutPage";
import BudgetCalculatorPage from "./pages/BudgetCalculatorPage";
import CountdownPage from "./pages/CountdownPage";
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

const AppShellLayout = lazy(() =>
  import("./components/AppShell").then((m) => ({ default: m.AppShellLayout })),
);
const AdminAnalyticsPage = lazy(() => import("./pages/AdminAnalyticsPage"));
const AdminFeedbackPage = lazy(() => import("./pages/AdminFeedbackPage"));
const AdminCategoriesPage = lazy(() => import("./pages/AdminCategoriesPage"));
const AdminSuppliersPage = lazy(() => import("./pages/AdminSuppliersPage"));
const AdminUsersPage = lazy(() => import("./pages/AdminUsersPage"));
const AdminVendorWaitlistPage = lazy(() => import("./pages/AdminVendorWaitlistPage"));
const BudgetPage = lazy(() => import("./pages/BudgetPage"));
const ChangeEmailPage = lazy(() => import("./pages/ChangeEmailPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const GuestPortalPage = lazy(() => import("./pages/GuestPortalPage"));
const GuestPreviewPage = lazy(() => import("./pages/GuestPreviewPage"));
const GuestsPage = lazy(() => import("./pages/GuestsPage"));
const HoneymoonPage = lazy(() => import("./pages/HoneymoonPage"));
const InvitePage = lazy(() => import("./pages/InvitePage"));
const LogisticsPage = lazy(() => import("./pages/LogisticsPage"));
const MediaPage = lazy(() => import("./pages/MediaPage"));
const MoodboardPage = lazy(() => import("./pages/MoodboardPage"));
const OnboardingWizard = lazy(() => import("./pages/OnboardingWizard"));
const PlanningPage = lazy(() => import("./pages/PlanningPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const RsvpCheckinPage = lazy(() => import("./pages/RsvpCheckinPage"));
const RsvpPage = lazy(() => import("./pages/RsvpPage"));
const SchedulePage = lazy(() => import("./pages/SchedulePage"));
const SeatingPage = lazy(() => import("./pages/SeatingPage"));
const SuppliersPage = lazy(() => import("./pages/SuppliersPage"));
const TimelinePage = lazy(() => import("./pages/TimelinePage"));
const VerifyEmailPage = lazy(() => import("./pages/VerifyEmailPage"));
const VendorClaimVerifyPage = lazy(() => import("./pages/VendorClaimVerifyPage"));
const VendorHomePage = lazy(() => import("./pages/VendorHomePage"));
const VerifySupplierPage = lazy(() => import("./pages/VerifySupplierPage"));
const WeddingWebsitePage = lazy(() => import("./pages/WeddingWebsitePage"));

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
  return children;
}

function RedirectIfAuthed({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (user) return <Navigate to="/app" replace />;
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

export default function App() {
  return (
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
      {/* SEO tool pages mounted at /eszkozok/* — each one targets a long-
       *  tail HU search query the landing alone can't rank for. */}
      <Route
        path="/eszkozok/eskuvo-koltsegvetes-kalkulator"
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
        path="/eszkozok/vendeglista-sablon"
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
        path="/eszkozok/rsvp-szoveg-generator"
        element={
          <Page>
            <RsvpGeneratorPage />
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
      <Route
        path="/vendor"
        element={
          <Page>
            <VendorHomePage />
          </Page>
        }
      />
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
        path="/rsvp/:code"
        element={
          <Page>
            <RsvpPage />
          </Page>
        }
      />
      <Route
        path="/g/:slug/:code"
        element={
          <Page>
            <GuestPortalPage />
          </Page>
        }
      />
      <Route
        path="/w/:slug"
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
      {/* All /app/* routes share one mounted AppShellLayout — the parent
       *  Route element renders <AppShell> + <Outlet/>, so the sidebar,
       *  header, and WorkspaceSwitcher stay alive across navigation. Per-
       *  child `<Page>` wrapper keeps the ErrorBoundary per-route so a
       *  render error in one page doesn't unmount the whole shell. */}
      <Route
        path="/app"
        element={
          <RequireAuth>
            <Suspense fallback={<FullScreenLoader />}>
              <AppShellLayout />
            </Suspense>
          </RequireAuth>
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
          path="guest-portal"
          element={
            <Page>
              <GuestPreviewPage />
            </Page>
          }
        />
        <Route
          path="moodboard"
          element={
            <Page>
              <MoodboardPage />
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
        <Route
          path="profile"
          element={
            <Page>
              <ProfilePage />
            </Page>
          }
        />
        <Route path="settings" element={<Navigate to="/app/profile" replace />} />
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
          path="admin/analytics"
          element={
            <Page>
              <RequireAdmin>
                <AdminAnalyticsPage />
              </RequireAdmin>
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
  );
}
