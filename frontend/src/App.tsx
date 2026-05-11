import type { JSX, ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useAuth } from "./lib/auth";
import AdminSuppliersPage from "./pages/AdminSuppliersPage";
import BudgetPage from "./pages/BudgetPage";
import DashboardPage from "./pages/DashboardPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import GuestsPage from "./pages/GuestsPage";
import InvitePage from "./pages/InvitePage";
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import NotFoundPage from "./pages/NotFoundPage";
import OnboardingWizard from "./pages/OnboardingWizard";
import RegisterPage from "./pages/RegisterPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import ProfilePage from "./pages/ProfilePage";
import RsvpCheckinPage from "./pages/RsvpCheckinPage";
import RsvpPage from "./pages/RsvpPage";
import SeatingPage from "./pages/SeatingPage";
import SuppliersPage from "./pages/SuppliersPage";
import VendorsPage from "./pages/VendorsPage";
import ChangeEmailPage from "./pages/ChangeEmailPage";
import VerifyEmailPage from "./pages/VerifyEmailPage";

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
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
        path="/onboarding"
        element={
          <Page>
            <RequireAuth>
              <OnboardingWizard />
            </RequireAuth>
          </Page>
        }
      />
      <Route
        path="/app"
        element={
          <Page>
            <RequireAuth>
              <DashboardPage />
            </RequireAuth>
          </Page>
        }
      />
      <Route
        path="/app/guests"
        element={
          <Page>
            <RequireAuth>
              <GuestsPage />
            </RequireAuth>
          </Page>
        }
      />
      <Route
        path="/app/budget"
        element={
          <Page>
            <RequireAuth>
              <BudgetPage />
            </RequireAuth>
          </Page>
        }
      />
      <Route
        path="/app/seating"
        element={
          <Page>
            <RequireAuth>
              <SeatingPage />
            </RequireAuth>
          </Page>
        }
      />
      <Route
        path="/app/suppliers"
        element={
          <Page>
            <RequireAuth>
              <SuppliersPage />
            </RequireAuth>
          </Page>
        }
      />
      <Route
        path="/app/profile"
        element={
          <Page>
            <RequireAuth>
              <ProfilePage />
            </RequireAuth>
          </Page>
        }
      />
      <Route path="/app/settings" element={<Navigate to="/app/profile" replace />} />
      <Route
        path="/app/admin/suppliers"
        element={
          <Page>
            <RequireAuth>
              <RequireAdmin>
                <AdminSuppliersPage />
              </RequireAdmin>
            </RequireAuth>
          </Page>
        }
      />
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
