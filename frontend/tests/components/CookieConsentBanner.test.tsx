// First-party consent gate that replaced the third-party Cookiebot CMP (its
// account's domain was never authorized and its trial expired, permanently
// blocking the banner). Pins the contract every analytics loader in
// index.html / seo_ssr.ts depends on: an inert `type="text/plain"
// data-cookieconsent="statistics"` script stays inert until the visitor
// decides, decline leaves it inert forever, accept flips it live immediately,
// and a stored "granted" decision from an earlier visit re-activates a fresh
// page's inert tags without showing the banner again.

import { beforeEach, describe, expect, it } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { CookieConsentBanner } from "@/components/CookieConsentBanner";
import { I18nProvider } from "@/lib/i18n";

const STORAGE_KEY = "weddly.consent_statistics";

/** Stand-in for the inert GTM/GA4/Clarity loaders the SSR head + index.html
 *  emit. Appended to `document.body` so the global test-setup afterEach
 *  (`document.body.innerHTML = ""`) clears it between tests. */
function insertGatedScript() {
  const el = document.createElement("script");
  el.type = "text/plain";
  el.setAttribute("data-cookieconsent", "statistics");
  el.setAttribute("data-marker", "gtm");
  el.textContent = "window.__gtmFired = true;";
  document.body.appendChild(el);
}

function gatedScriptIsInert(): boolean {
  return document.querySelector('script[type="text/plain"][data-marker="gtm"]') !== null;
}

function gatedScriptIsLive(): boolean {
  const el = document.querySelector('[data-marker="gtm"]');
  return el !== null && el.getAttribute("type") !== "text/plain";
}

function renderBanner() {
  return render(
    <I18nProvider>
      <CookieConsentBanner />
    </I18nProvider>,
  );
}

describe("CookieConsentBanner", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows the banner and leaves gated scripts inert when no decision is stored", () => {
    insertGatedScript();
    renderBanner();
    expect(screen.getByText("We use cookies")).toBeTruthy();
    expect(gatedScriptIsInert()).toBe(true);
  });

  it("accepting activates gated scripts, hides the banner and remembers the choice", () => {
    insertGatedScript();
    renderBanner();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(screen.queryByText("We use cookies")).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBe("granted");
    expect(gatedScriptIsLive()).toBe(true);
  });

  it("declining hides the banner, keeps scripts inert and remembers the choice", () => {
    insertGatedScript();
    renderBanner();
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(screen.queryByText("We use cookies")).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBe("declined");
    expect(gatedScriptIsInert()).toBe(true);
  });

  it("a stored 'granted' decision from an earlier visit re-activates a fresh page's scripts without showing the banner", () => {
    localStorage.setItem(STORAGE_KEY, "granted");
    insertGatedScript();
    renderBanner();
    expect(screen.queryByText("We use cookies")).toBeNull();
    expect(gatedScriptIsLive()).toBe(true);
  });

  it("a stored 'declined' decision does not show the banner again or activate scripts", () => {
    localStorage.setItem(STORAGE_KEY, "declined");
    insertGatedScript();
    renderBanner();
    expect(screen.queryByText("We use cookies")).toBeNull();
    expect(gatedScriptIsInert()).toBe(true);
  });
});
