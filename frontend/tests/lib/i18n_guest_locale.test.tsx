// Guest pages (wedding site, RSVP) open in the COUPLE's language for a visitor
// who never picked one, and that default is never saved: it must not become
// the visitor's preference, and the visitor's own pick always wins.

import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { _preloadHuForTests, I18nProvider, useGuestLocaleDefault, useT } from "@/lib/i18n";

function Probe({ coupleLocale }: { coupleLocale: "hu" | "en" | undefined }) {
  useGuestLocaleDefault(coupleLocale);
  const { locale } = useT();
  return <span data-testid="loc">{locale}</span>;
}

beforeAll(async () => {
  await _preloadHuForTests();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("useGuestLocaleDefault", () => {
  it("switches a first-time visitor to the couple's language without saving it", () => {
    localStorage.clear();
    const { getByTestId } = render(
      <I18nProvider>
        <Probe coupleLocale="hu" />
      </I18nProvider>,
    );
    expect(getByTestId("loc").textContent).toBe("hu");
    expect(localStorage.getItem("weddly.locale")).toBeNull();
  });

  it("leaves a visitor who picked a language alone", () => {
    localStorage.setItem("weddly.locale", "en");
    const { getByTestId } = render(
      <I18nProvider>
        <Probe coupleLocale="hu" />
      </I18nProvider>,
    );
    expect(getByTestId("loc").textContent).toBe("en");
  });
});
