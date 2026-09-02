// Component tests for ToolLangRoute — the single parametrized route that
// serves /{lang}/tools/{slug} for all 7 tool pages × 5 UI languages (see
// App.tsx). Covers: an unknown language or slug renders NotFoundPage
// instead of crashing, a valid combo renders the right tool page, and the
// URL's language wins over whatever locale was already saved — landing on
// a language-prefixed URL is as explicit a signal as clicking the switcher.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/lib/auth";
import { _preloadEsForTests, _preloadHuForTests, I18nProvider } from "@/lib/i18n";
import { ToolLangRoute } from "@/App";

beforeAll(async () => {
  await Promise.all([_preloadHuForTests(), _preloadEsForTests()]);
});

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <I18nProvider>
        {/* Every tool page renders inside PublicShell, which reads
         *  useAuth() — see the same note in couple_cards.test.tsx. Suspense
         *  is required here (unlike that file) because ToolLangRoute picks
         *  its page from the real lazyWithReload map in App.tsx, not a
         *  directly-imported component. */}
        <AuthProvider>
          <Suspense fallback={<div>loading</div>}>
            <Routes>
              <Route path="/:lang/tools/:slug" element={<ToolLangRoute />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

describe("ToolLangRoute", () => {
  it("renders NotFoundPage for an unrecognised language", async () => {
    renderAt("/xx/tools/seating-chart-builder");
    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
    // Not the seating-chart page's own heading — confirms this is the 404,
    // not a silent fallthrough to some other tool.
    expect(screen.queryByText(/planos de mesas|ültetési rend|seating chart/i)).toBeNull();
  });

  it("renders NotFoundPage for an unrecognised slug", async () => {
    renderAt("/en/tools/not-a-real-tool");
    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("renders the matching tool page for a valid language + slug", async () => {
    renderAt("/hu/tools/seating-chart-builder");
    expect(
      await screen.findByRole("heading", { level: 1, name: /ültetési rend/i }),
    ).toBeInTheDocument();
  });

  it("the URL's language wins over a previously saved locale", async () => {
    // A returning visitor with HU saved landing on the ES URL should see
    // ES, not HU — ToolLangRoute's setLocale effect overrides the saved
    // preference on mount, same weight as clicking the language switcher.
    window.localStorage.setItem("weddly.locale", "hu");
    renderAt("/es/tools/seating-chart-builder");
    expect(
      await screen.findByRole("heading", { level: 1, name: /planos de mesas/i }),
    ).toBeInTheDocument();
  });
});
