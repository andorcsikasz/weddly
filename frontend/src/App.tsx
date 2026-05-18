import type { JSX, ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShellLayout } from "./components/AppShell";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { VerifyEmailGate } from "./components/VerifyEmailGate";
import { useAuth } from "./lib/auth";
import AboutPage from "./pages/AboutPage";
import AdminAnalyticsPage from "./pages/AdminAnalyticsPage";
import AdminFeedbackPage from "./pages/AdminFeedbackPage";
import AdminCategoriesPage from "./pages/AdminCategoriesPage";
import AdminSuppliersPage from "./pages/AdminSuppliersPage";
import AdminUsersPage from "./pages/AdminUsersPage";
import AdminVendorWaitlistPage from "./pages/AdminVendorWaitlistPage";
import BudgetPage from "./pages/BudgetPage";
import DashboardPage from "./pages/DashboardPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import GuestPortalPage from "./pages/GuestPortalPage";
import GuestPreviewPage from "./pages/GuestPreviewPage";
import GuestsPage from "./pages/GuestsPage";
import InvitePage from "./pages/InvitePage";
import LandingPage from "./pages/LandingPage";
import LogisticsPage from "./pages/LogisticsPage";
import LoginPage from "./pages/LoginPage";
import NotFoundPage from "./pages/NotFoundPage";
import OnboardingWizard from "./pages/OnboardingWizard";
import PlanningPage from "./pages/PlanningPage";
import PrivacyPage from "./pages/PrivacyPage";
import RegisterPage from "./pages/RegisterPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import ProfilePage from "./pages/ProfilePage";
import RsvpCheckinPage from "./pages/RsvpCheckinPage";
import RsvpPage from "./pages/RsvpPage";
import SchedulePage from "./pages/SchedulePage";
import SeatingPage from "./pages/SeatingPage";
import HoneymoonPage from "./pages/HoneymoonPage";
import ImprintPage from "./pages/ImprintPage";
import MediaPage from "./pages/MediaPage";
import MoodboardPage from "./pages/MoodboardPage";
import SubscriptionTermsPage from "./pages/SubscriptionTermsPage";
import SuppliersPage from "./pages/SuppliersPage";
import TermsPage from "./pages/TermsPage";
import TimelinePage from "./pages/TimelinePage";
import VendorsPage from "./pages/VendorsPage";
import ChangeEmailPage from "./pages/ChangeEmailPage";
import VerifyEmailPage from "./pages/VerifyEmailPage";
import VerifySupplierPage from "./pages/VerifySupplierPage";

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.verified_email) return <VerifyEmailGate email={user.email} />;
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
// "Go to home" link without a full reload.
function Page({ children }: { children: ReactNode }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
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
            <AppShellLayout />
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
        <Route
          path="suppliers"
          element={
            <Page>
              <SuppliersPage />
            </Page>
          }
        />
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
