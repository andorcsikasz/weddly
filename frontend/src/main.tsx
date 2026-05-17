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

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

createRoot(root).render(
  <StrictMode>
    <I18nProvider>
      <AppProviders>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </AppProviders>
    </I18nProvider>
  </StrictMode>,
);
