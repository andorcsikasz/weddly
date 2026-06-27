import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AppProviders } from "./components/ui";
import "./index.css";
import { AuthProvider } from "./lib/auth";
import { applyDensity, getStoredDensity } from "./lib/density";
import { I18nProvider } from "./lib/i18n";

// Apply the saved density class on <html> *before* React mounts so the
// first paint already has the right text sizes — otherwise a comfortable
// user briefly sees the compact 10/11px labels on every page load.
applyDensity(getStoredDensity());

// Strip the `?h=1` cache-buster that the weddly.hu → tryweddly.com redirect
// appends. It exists only to break the infinite loop for browsers that cached
// the old permanent `tryweddly.com → weddly.hu` 301 (the redirect target must
// differ from the poisoned URL). By the time the SPA boots the redirect has
// done its job, so drop the param from the address bar — no reload — for a
// clean canonical URL. Other query params are preserved.
try {
  const url = new URL(window.location.href);
  if (url.searchParams.has("h")) {
    url.searchParams.delete("h");
    const qs = url.searchParams.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${qs ? `?${qs}` : ""}${url.hash}`,
    );
  }
} catch {
  // Never block boot on URL cleanup.
}

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

createRoot(root).render(
  <StrictMode>
    <I18nProvider>
      <AppProviders>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </AppProviders>
    </I18nProvider>
  </StrictMode>,
);
