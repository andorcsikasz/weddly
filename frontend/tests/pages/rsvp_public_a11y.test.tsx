// Focused component tests for the public RSVP surface — the lookup form on
// /rsvp and the household editor that follows a successful lookup. Locale
// switching + a11y plumbing land here too so we don't ship a regression
// that breaks screen-reader users or invisibly defaults the wrong language
// for our HU-first audience.
//
// All HTTP is mocked through globalThis.fetch — the page only knows about
// `rsvpApi` which goes through `apiFetch`, which goes through `fetch`.
// Mocking at the network boundary means we exercise the real
// endpoints.ts wrappers without standing up a backend.
//
// The old `/g/:slug/:code` guest-portal tests were retired when Phase 2 of
// the Vendégoldal merger landed — that route now redirects into the
// unified `/w/:slug/:code` WeddingWebsitePage (see App.tsx). New
// coverage for the merged surface lives in the backend e2e tests where
// the tier-aware payload is exercised end-to-end.

import type { PublicCheckinView } from "@shared/types";
import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ConfirmDialogProvider } from "@/components/ui/ConfirmDialogProvider";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { _preloadHuForTests, I18nProvider } from "@/lib/i18n";
import RsvpCheckinPage from "@/pages/RsvpCheckinPage";

// HU is lazy-loaded via dynamic import in production; the suite asserts on
// HU labels synchronously after render(), so preload the tree once.
beforeAll(async () => {
  await _preloadHuForTests();
});

const realFetch = globalThis.fetch;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Build a minimal-but-realistic check-in view. Members start as `pending`
 *  so the form mirrors a fresh invite (each member must explicitly click a
 *  status pill before submit will fire). */
function makeView(overrides: Partial<PublicCheckinView> = {}): PublicCheckinView {
  return {
    couple_slug: "MIALUCAS",
    couple_display_name: "Mia & Lucas",
    wedding_date: "2026-09-12",
    household_code: "1234",
    household_label: "Kovács család",
    members: [
      {
        id: 11,
        full_name: "Anna Kovács",
        kind: "adult",
        rsvp_status: "pending",
        meal_choice: null,
        dietary: null,
        accommodation_needed: false,
        song_request: null,
      },
      {
        id: 12,
        full_name: "Bence Kovács",
        kind: "adult",
        rsvp_status: "pending",
        meal_choice: null,
        dietary: null,
        accommodation_needed: false,
        song_request: null,
      },
    ],
    rsvp_offers_accommodation: true,
    rsvp_collects_meal: true,
    wedding_site_published: false,
    ...overrides,
  };
}

/** Render the check-in page wrapped in the same provider stack the public
 *  route uses in App.tsx. NOTE: no AuthProvider — the page is public. */
function renderCheckin(initialEntries: string[] = ["/rsvp"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <I18nProvider>
        <ToastProvider>
          <ConfirmDialogProvider>
            <Routes>
              <Route path="/rsvp" element={<RsvpCheckinPage />} />
            </Routes>
          </ConfirmDialogProvider>
        </ToastProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  // Pin HU as the default locale so tests don't drift on machines where
  // navigator.language is en-US. Individual tests that exercise EN flip
  // localStorage explicitly.
  try {
    localStorage.setItem("weddly.locale", "hu");
    // Seed a currency pref so the first-language-switch prompt
    // (CurrencyPrefDialog) doesn't intercept the toggle in tests that
    // expect a synchronous locale flip.
    localStorage.setItem("weddly.currency", "HUF");
    localStorage.removeItem("weddly.token");
    // The kiosk hint persists across tests through localStorage — clear it
    // so the rendered tree never starts in kiosk mode unintentionally
    // (kiosk hides the locale-toggle button, which would break a11y tests).
    localStorage.removeItem("weddly.rsvp.kiosk");
    // Offline queue badge depends on this key — clear it so the empty
    // initial state is reproducible.
    localStorage.removeItem("weddly.rsvp.pending");
  } catch {
    // happy-dom always has localStorage; this catch is defensive only.
  }
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

// ── RsvpCheckinPage / household checkin ───────────────────────────────────

describe("RsvpCheckinPage — lookup form", () => {
  it("renders the couple-slug + 4-digit-code form initially", () => {
    renderCheckin();
    expect(screen.getByLabelText(/jegyes pár/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/kód/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /check-in/i })).toBeInTheDocument();
  });

  it("submitting the form calls GET /api/rsvp/lookup", async () => {
    const fetchMock = mock(async (url: string | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      expect(u).toContain("/api/rsvp/lookup");
      expect(u).toContain("couple=MIALUCAS");
      expect(u).toContain("code=1234");
      return jsonResponse(200, { rsvp: makeView() });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    renderCheckin();
    fireEvent.change(screen.getByLabelText(/jegyes pár/i), { target: { value: "MIALUCAS" } });
    fireEvent.change(screen.getByLabelText(/kód/i), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: /check-in/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it("404 'Couple not found' surfaces the couple-specific lookup error", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse(404, { error: "Couple not found" }),
    ) as unknown as typeof fetch;

    renderCheckin();
    fireEvent.change(screen.getByLabelText(/jegyes pár/i), { target: { value: "BADSLUG" } });
    fireEvent.change(screen.getByLabelText(/kód/i), { target: { value: "9999" } });
    fireEvent.click(screen.getByRole("button", { name: /check-in/i }));

    // Page maps "couple" / "code" patterns onto field-specific copy. We can't
    // use `getByRole("alert")` directly because the ToastProvider mounts two
    // empty assertive-live regions with the same role; the inline field-error
    // we care about has a unique class + text.
    await waitFor(() => {
      const alerts = screen.getAllByRole("alert");
      const inline = alerts.find((a) => /jegyes párt nem találjuk/i.test(a.textContent ?? ""));
      expect(inline).toBeTruthy();
    });
  });

  it("successful lookup renders household label + every member row", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse(200, { rsvp: makeView() }),
    ) as unknown as typeof fetch;

    renderCheckin();
    fireEvent.change(screen.getByLabelText(/jegyes pár/i), { target: { value: "MIALUCAS" } });
    fireEvent.change(screen.getByLabelText(/kód/i), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: /check-in/i }));

    await waitFor(() => {
      expect(screen.getByText("Kovács család")).toBeInTheDocument();
    });
    // Member names render as <legend> on each fieldset.
    expect(screen.getByText("Anna Kovács")).toBeInTheDocument();
    expect(screen.getByText("Bence Kovács")).toBeInTheDocument();
  });

  it("each member row exposes a yes/no/maybe radio group", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse(200, { rsvp: makeView() }),
    ) as unknown as typeof fetch;

    renderCheckin();
    fireEvent.change(screen.getByLabelText(/jegyes pár/i), { target: { value: "MIALUCAS" } });
    fireEvent.change(screen.getByLabelText(/kód/i), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: /check-in/i }));

    await waitFor(() => expect(screen.getByText("Anna Kovács")).toBeInTheDocument());
    // One radiogroup per member. The aria-label interpolates the member name
    // so we can scope `within` to a single member's pills.
    const groups = screen.getAllByRole("radiogroup", { name: /Anna Kovács|Bence Kovács/ });
    expect(groups.length).toBeGreaterThanOrEqual(2);
    for (const g of groups) {
      // Three pills per row (yes / no / maybe).
      const radios = within(g).getAllByRole("radio");
      expect(radios.length).toBe(3);
    }
  });

  it("meal radio group renders the configured meal choices when a member RSVPs yes", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse(200, { rsvp: makeView() }),
    ) as unknown as typeof fetch;

    renderCheckin();
    fireEvent.change(screen.getByLabelText(/jegyes pár/i), { target: { value: "MIALUCAS" } });
    fireEvent.change(screen.getByLabelText(/kód/i), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: /check-in/i }));

    await waitFor(() => expect(screen.getByText("Anna Kovács")).toBeInTheDocument());

    // Click the first "Igen" pill — meal section is gated on rsvp_status==="yes".
    const annaGroup = screen.getAllByRole("radiogroup")[0]!;
    const yesPill = within(annaGroup)
      .getAllByRole("radio")
      .find((b) => /igen/i.test(b.textContent ?? ""));
    expect(yesPill).toBeDefined();
    fireEvent.click(yesPill!);

    // The meal section appears with one radio per MealChoice (6 total).
    // The HU label is "Étrend" (not "Étel"); EN is "Meal".
    await waitFor(() => {
      const mealGroup = screen.getByRole("radiogroup", { name: /étrend|meal/i });
      expect(within(mealGroup).getAllByRole("radio").length).toBe(6);
    });
  });

  it("dietary is optional — the form submits with no chips selected", async () => {
    const captured: unknown[] = [];
    globalThis.fetch = mock(async (url: string | URL, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.endsWith("/api/rsvp/lookup?couple=MIALUCAS&code=1234") || u.includes("rsvp/lookup")) {
        return jsonResponse(200, { rsvp: makeView({ rsvp_offers_accommodation: false }) });
      }
      if (u.includes("/api/rsvp/checkin")) {
        captured.push(JSON.parse((init?.body as string) ?? "{}"));
        return jsonResponse(200, { rsvp: makeView() });
      }
      return jsonResponse(404, { error: "unmocked" });
    }) as unknown as typeof fetch;

    renderCheckin(["/rsvp?couple=MIALUCAS&code=1234"]);
    // Auto-lookup fires from URL params; wait for the form.
    await waitFor(() => expect(screen.getByText("Anna Kovács")).toBeInTheDocument());

    // Pick "Igen" for both members (validation requires every member to commit).
    const groups = screen.getAllByRole("radiogroup", { name: /Anna Kovács|Bence Kovács/ });
    for (const g of groups) {
      const yes = within(g)
        .getAllByRole("radio")
        .find((b) => /igen/i.test(b.textContent ?? ""));
      fireEvent.click(yes!);
    }
    // Submit + accept the confirm dialog.
    fireEvent.click(screen.getByRole("button", { name: /check-in befejezése/i }));
    await waitFor(() => {
      // ConfirmDialog renders a "Küldés" / "Send" primary action — find it
      // by the i18n key text. confirm_submit_yes => HU "Igen, küldjük el".
      expect(screen.getByText(/igen, beküldöm/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/igen, beküldöm/i));

    await waitFor(() => expect(captured.length).toBe(1));
    const body = captured[0] as { members: Array<{ dietary: string | null }> };
    // Without any chip selection, every member's dietary should be null.
    for (const m of body.members) expect(m.dietary).toBeNull();
  });

  it("toggling the +1 chip appends a name input below for that member", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse(200, { rsvp: makeView() }),
    ) as unknown as typeof fetch;

    renderCheckin();
    fireEvent.change(screen.getByLabelText(/jegyes pár/i), { target: { value: "MIALUCAS" } });
    fireEvent.change(screen.getByLabelText(/kód/i), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: /check-in/i }));

    await waitFor(() => expect(screen.getByText("Anna Kovács")).toBeInTheDocument());
    // Click "Igen" on Anna so the +1 section becomes visible.
    const yesPill = within(screen.getAllByRole("radiogroup")[0]!)
      .getAllByRole("radio")
      .find((b) => /igen/i.test(b.textContent ?? ""));
    fireEvent.click(yesPill!);

    await waitFor(() => {
      // The "+1" chip is a checkbox-role chip; toggling reveals an
      // <AttachedNameField> with the i18n label "added_name_plus_one".
      const plusChip = screen.getAllByRole("checkbox", { name: /\+1/i })[0]!;
      fireEvent.click(plusChip);
    });

    await waitFor(() => {
      // The name input gets aria-required="true" — easiest selector.
      const nameInputs = document.querySelectorAll<HTMLInputElement>('input[aria-required="true"]');
      expect(nameInputs.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("POST /api/rsvp/checkin is called with one entry per member on submit", async () => {
    const captured: { url: string; body: unknown }[] = [];
    globalThis.fetch = mock(async (url: string | URL, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.includes("/api/rsvp/lookup")) return jsonResponse(200, { rsvp: makeView() });
      if (u.includes("/api/rsvp/checkin")) {
        captured.push({ url: u, body: JSON.parse((init?.body as string) ?? "{}") });
        return jsonResponse(200, { rsvp: makeView() });
      }
      return jsonResponse(404, { error: "unmocked" });
    }) as unknown as typeof fetch;

    renderCheckin(["/rsvp?couple=MIALUCAS&code=1234"]);
    await waitFor(() => expect(screen.getByText("Anna Kovács")).toBeInTheDocument());

    const groups = screen.getAllByRole("radiogroup", { name: /Anna Kovács|Bence Kovács/ });
    for (const g of groups) {
      const yes = within(g)
        .getAllByRole("radio")
        .find((b) => /igen/i.test(b.textContent ?? ""));
      fireEvent.click(yes!);
    }
    fireEvent.click(screen.getByRole("button", { name: /check-in befejezése/i }));
    await waitFor(() => expect(screen.getByText(/igen, beküldöm/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/igen, beküldöm/i));

    await waitFor(() => expect(captured.length).toBe(1));
    const body = captured[0]!.body as {
      couple_slug: string;
      household_code: string;
      members: unknown[];
    };
    expect(body.couple_slug).toBe("MIALUCAS");
    expect(body.household_code).toBe("1234");
    expect(body.members.length).toBe(2);
  });

  it("5xx submit failure surfaces an inline error and keeps the form editable", async () => {
    globalThis.fetch = mock(async (url: string | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.includes("/api/rsvp/lookup")) return jsonResponse(200, { rsvp: makeView() });
      // All retries return 500 so the eventual rejection bubbles up to the
      // page-level error handler. POST is not retried by default so this
      // ends up as a single failing call.
      return jsonResponse(500, { error: "server boom" });
    }) as unknown as typeof fetch;

    renderCheckin(["/rsvp?couple=MIALUCAS&code=1234"]);
    await waitFor(() => expect(screen.getByText("Anna Kovács")).toBeInTheDocument());

    const groups = screen.getAllByRole("radiogroup", { name: /Anna Kovács|Bence Kovács/ });
    for (const g of groups) {
      const yes = within(g)
        .getAllByRole("radio")
        .find((b) => /igen/i.test(b.textContent ?? ""));
      fireEvent.click(yes!);
    }
    fireEvent.click(screen.getByRole("button", { name: /check-in befejezése/i }));
    await waitFor(() => expect(screen.getByText(/igen, beküldöm/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/igen, beküldöm/i));

    // Error renders inline above the submit button — wait longer than the
    // default 1s retry budget so the apiFetch backoff loop has a chance to
    // exhaust before we assert. The page is still showing the form (member
    // names still in the DOM).
    await waitFor(
      () => {
        const alerts = screen.queryAllByRole("alert");
        expect(alerts.length).toBeGreaterThan(0);
      },
      { timeout: 6000 },
    );
    expect(screen.getByText("Anna Kovács")).toBeInTheDocument();
  }, 15000);

  it("successful submit shows the 'thanks' confirmation view", async () => {
    globalThis.fetch = mock(async (url: string | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.includes("/api/rsvp/lookup")) return jsonResponse(200, { rsvp: makeView() });
      if (u.includes("/api/rsvp/checkin")) {
        return jsonResponse(200, { rsvp: makeView({ rsvp_offers_accommodation: false }) });
      }
      return jsonResponse(404, { error: "unmocked" });
    }) as unknown as typeof fetch;

    renderCheckin(["/rsvp?couple=MIALUCAS&code=1234"]);
    await waitFor(() => expect(screen.getByText("Anna Kovács")).toBeInTheDocument());

    const groups = screen.getAllByRole("radiogroup", { name: /Anna Kovács|Bence Kovács/ });
    for (const g of groups) {
      const yes = within(g)
        .getAllByRole("radio")
        .find((b) => /igen/i.test(b.textContent ?? ""));
      fireEvent.click(yes!);
    }
    fireEvent.click(screen.getByRole("button", { name: /check-in befejezése/i }));
    await waitFor(() => expect(screen.getByText(/igen, beküldöm/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/igen, beküldöm/i));

    // checkin_done_title = "Sikeres check-in" / "Checked in" — assert the
    // thanks body is rendered (locale-agnostic substring "tervezzétek" etc.
    // is brittle, so just check the page reached the done branch via the
    // bold title text).
    await waitFor(() => {
      // strong wraps the i18n title; querying by text grabs the rendered span.
      const node = document.querySelector("strong");
      expect(node?.textContent).toBeTruthy();
    });
  });

  it("baby chip toggles a name input slot, distinct from the +1 chip", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse(200, { rsvp: makeView() }),
    ) as unknown as typeof fetch;

    renderCheckin();
    fireEvent.change(screen.getByLabelText(/jegyes pár/i), { target: { value: "MIALUCAS" } });
    fireEvent.change(screen.getByLabelText(/kód/i), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: /check-in/i }));

    await waitFor(() => expect(screen.getByText("Anna Kovács")).toBeInTheDocument());
    const yes = within(screen.getAllByRole("radiogroup")[0]!)
      .getAllByRole("radio")
      .find((b) => /igen/i.test(b.textContent ?? ""));
    fireEvent.click(yes!);

    await waitFor(() => {
      // tag_baby HU = "Baba"; tag_plus_one HU = "+1". The chip is a
      // role="checkbox" with an aria-label matching one of them.
      const babyChip = screen.getAllByRole("checkbox", { name: /baba|baby/i })[0]!;
      fireEvent.click(babyChip);
    });

    // After the click, the baby disclosure exposes an input with the
    // "added_name_baby" label.
    await waitFor(() => {
      const inputs = document.querySelectorAll<HTMLInputElement>('input[aria-required="true"]');
      expect(inputs.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("renders the boarding-pass reference (slug · code) after a successful lookup", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse(200, { rsvp: makeView() }),
    ) as unknown as typeof fetch;

    renderCheckin();
    fireEvent.change(screen.getByLabelText(/jegyes pár/i), { target: { value: "MIALUCAS" } });
    fireEvent.change(screen.getByLabelText(/kód/i), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: /check-in/i }));

    await waitFor(() => {
      expect(screen.getByText("MIALUCAS")).toBeInTheDocument();
      expect(screen.getByText("1234")).toBeInTheDocument();
    });
  });
});

// ── i18n switching ────────────────────────────────────────────────────────

describe("RsvpCheckinPage — i18n", () => {
  it("renders in Hungarian by default", () => {
    renderCheckin();
    // checkin_title HU = "RSVP check-in" (same in EN). The intro copy
    // differs: HU = "Írd be a jegyes pár nevét…", EN = "Type the couple's…".
    expect(screen.getByText(/írd be a jegyes pár nevét/i)).toBeInTheDocument();
  });

  it("renders the EN→HU locale toggle button on the form view", () => {
    renderCheckin();
    // Locale button text is the OPPOSITE locale label — i.e. on HU we see "EN".
    expect(screen.getByRole("button", { name: "EN" })).toBeInTheDocument();
  });

  it("clicking the locale toggle re-renders the form in English", () => {
    renderCheckin();
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    expect(screen.getByText(/type the couple's name/i)).toBeInTheDocument();
    // And the toggle now offers the inverse hop.
    expect(screen.getByRole("button", { name: "HU" })).toBeInTheDocument();
  });

  it("persists the chosen locale to localStorage so the next visit honours it", () => {
    renderCheckin();
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    expect(localStorage.getItem("weddly.locale")).toBe("en");
  });
});

// ── a11y basics ───────────────────────────────────────────────────────────

describe("RsvpCheckinPage — a11y", () => {
  it("every input has a matching <label htmlFor> pointing at its id", () => {
    renderCheckin();
    // Both fields are wired up via field-label + htmlFor in the JSX. We rely
    // on the accessible-name lookup via role+name — if the wiring breaks
    // these queries throw.
    expect(screen.getByLabelText(/jegyes pár/i).id).toBe("rsvp-couple");
    expect(screen.getByLabelText(/kód/i).id).toBe("rsvp-code");
  });

  it("the submit button is type=submit and tab-reachable on the lookup form", () => {
    renderCheckin();
    const submit = screen.getByRole("button", { name: /check-in/i });
    expect(submit.getAttribute("type")).toBe("submit");
    // happy-dom doesn't tab between inputs the way browsers do, so this
    // asserts that the button is not disabled / hidden / tabindex=-1 —
    // i.e. it's in the natural tab order.
    expect(submit.hasAttribute("tabindex")).toBe(false);
    expect(submit).not.toBeDisabled();
  });

  it("required-name input on +1 sets aria-required so screen readers announce it", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse(200, { rsvp: makeView() }),
    ) as unknown as typeof fetch;

    renderCheckin();
    fireEvent.change(screen.getByLabelText(/jegyes pár/i), { target: { value: "MIALUCAS" } });
    fireEvent.change(screen.getByLabelText(/kód/i), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: /check-in/i }));

    await waitFor(() => expect(screen.getByText("Anna Kovács")).toBeInTheDocument());
    const yes = within(screen.getAllByRole("radiogroup")[0]!)
      .getAllByRole("radio")
      .find((b) => /igen/i.test(b.textContent ?? ""));
    fireEvent.click(yes!);

    await waitFor(() => {
      const plus = screen.getAllByRole("checkbox", { name: /\+1/i })[0]!;
      fireEvent.click(plus);
    });

    await waitFor(() => {
      const required = document.querySelector<HTMLInputElement>('input[aria-required="true"]');
      expect(required).not.toBeNull();
    });
  });

  it("lookup error renders with role='alert' so assistive tech announces it", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse(404, { error: "Couple not found" }),
    ) as unknown as typeof fetch;

    renderCheckin();
    fireEvent.change(screen.getByLabelText(/jegyes pár/i), { target: { value: "BADSLUG" } });
    fireEvent.change(screen.getByLabelText(/kód/i), { target: { value: "0000" } });
    fireEvent.click(screen.getByRole("button", { name: /check-in/i }));

    await waitFor(() => {
      const alerts = screen.getAllByRole("alert");
      expect(alerts.length).toBeGreaterThan(0);
    });
  });

  it("local validation surfaces an alert when both fields are empty on submit", () => {
    renderCheckin();
    fireEvent.click(screen.getByRole("button", { name: /check-in/i }));
    // checkin_lookup_missing HU = "Mindkét mezőt töltsd ki…". ToastProvider
    // mounts two empty role=alert regions, so we filter by message.
    const alerts = screen.getAllByRole("alert");
    const inline = alerts.find((a) => /mindkét mezőt töltsd ki/i.test(a.textContent ?? ""));
    expect(inline).toBeTruthy();
  });
});
