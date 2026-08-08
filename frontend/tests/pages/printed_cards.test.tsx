import { afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DEFAULT_DESIGN } from "@shared/design";
import { ConfirmDialogProvider, ToastProvider } from "@/components/ui";
import { _preloadHuForTests, I18nProvider } from "@/lib/i18n";
import DesignPage from "@/pages/DesignPage";

const realFetch = globalThis.fetch;
const realCreateObjectUrl = URL.createObjectURL;
const realRevokeObjectUrl = URL.revokeObjectURL;
const realAnchorClick = HTMLAnchorElement.prototype.click;

beforeAll(async () => {
  await _preloadHuForTests();
  localStorage.setItem("weddly.locale", "hu");
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  URL.createObjectURL = realCreateObjectUrl;
  URL.revokeObjectURL = realRevokeObjectUrl;
  HTMLAnchorElement.prototype.click = realAnchorClick;
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Design -> Printed cards client parity", () => {
  it("uses one fresh Blob for exact preview and download, then clears it on card switch", async () => {
    const printRequests: string[] = [];
    const objectUrls: string[] = [];
    URL.createObjectURL = mock(() => {
      // about:blank keeps happy-dom from trying (and failing) to navigate its
      // iframe to the otherwise-correct mocked blob: URL.
      const url = `about:blank#printed-card-${objectUrls.length + 1}`;
      objectUrls.push(url);
      return url;
    });
    URL.revokeObjectURL = mock(() => undefined);
    HTMLAnchorElement.prototype.click = mock(() => undefined);

    const couple = {
      id: 17,
      slug: "ANDORSARI",
      display_name: "Andor & Sári",
      bride_name: "Sári",
      groom_name: "Andor",
      wedding_date: "2027-05-29",
      country: "HU",
      venue_name: "Árvíztűrő Udvar",
      venue_city: "Győr",
      menu_card: { courses: [] },
      design: DEFAULT_DESIGN,
      billing: { entitled: true, reason: "trialing" },
    };
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/print/")) {
        printRequests.push(url);
        return new Promise<Response>((resolve) =>
          setTimeout(
            () =>
              resolve(
                new Response(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]), {
                  status: 200,
                  headers: { "Content-Type": "application/pdf" },
                }),
              ),
            10,
          ),
        );
      }
      if (url.includes("/api/couples/current")) return Promise.resolve(json({ couple }));
      if (url.includes("/api/schedule")) {
        return Promise.resolve(
          json({
            events: [
              {
                id: 41,
                couple_id: 17,
                label: "Naplementés fogadalom",
                starts_at_minutes: 16 * 60 + 45,
                duration_minutes: 45,
                location: "Árvíztűrő Udvar",
                notes: null,
                responsible: null,
                couple_supplier_id: null,
                sort_order: 0,
                is_key_moment: true,
                created_at: 1,
                updated_at: 2,
              },
            ],
          }),
        );
      }
      if (url.includes("/api/guests")) {
        return Promise.resolve(json({ guests: [{ id: 5, full_name: "Árvíztűrő D'Árvíz" }] }));
      }
      if (url.includes("/api/seating/plan")) {
        return Promise.resolve(
          json({
            tables: [{ id: 3, label: "12", updated_at: 2 }],
            assignments: [{ guest_id: 5, table_id: 3, seat_index: 0 }],
          }),
        );
      }
      if (url.includes("/api/wishlist")) return Promise.resolve(json({ items: [] }));
      return Promise.resolve(json({}));
    }) as unknown as typeof fetch;

    const { container } = render(
      <I18nProvider>
        <ToastProvider>
          <ConfirmDialogProvider>
            <MemoryRouter initialEntries={["/app/design/print"]}>
              <DesignPage />
            </MemoryRouter>
          </ConfirmDialogProvider>
        </ToastProvider>
      </I18nProvider>,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Programkártya" })).toBeInTheDocument(),
    );
    const thumbnailCanvases = container.querySelectorAll(
      "span.pointer-events-none.grid.aspect-\\[3\\/4\\]",
    );
    expect(thumbnailCanvases.length).toBe(6);
    for (const canvas of thumbnailCanvases) {
      expect(canvas.className).toContain("overflow-visible");
      expect(canvas.className).not.toContain("overflow-hidden");
    }

    fireEvent.click(screen.getByRole("button", { name: "Programkártya" }));
    await waitFor(() =>
      expect(screen.getAllByText("Naplementés fogadalom").length).toBeGreaterThan(0),
    );
    fireEvent.click(screen.getByRole("button", { name: "Egzakt PDF előnézet" }));
    // Start Download while Exact preview is still in flight. The in-flight
    // promise is shared too, so this must remain one network request.
    fireEvent.click(screen.getByRole("button", { name: "Letöltés" }));
    await waitFor(() => expect(printRequests.length).toBe(1));
    expect(printRequests[0]).toEndWith("/api/print/schedule-card");
    expect(printRequests[0]).not.toEndWith("/api/print/schedule");
    await waitFor(() => expect(objectUrls.length).toBe(2));
    const iframe = screen.getByTitle("Egzakt PDF előnézet") as HTMLIFrameElement;
    const iframeSrc = iframe.getAttribute("src");
    expect(iframeSrc).not.toBeNull();
    expect(objectUrls).toContain(iframeSrc ?? "");
    // Preview and Download created two object URLs from one cached Blob; the
    // endpoint itself was fetched exactly once.
    expect(printRequests.length).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Köszönőkártya" }));
    await waitFor(() => expect(screen.queryByTitle("Egzakt PDF előnézet")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Egzakt PDF előnézet" }));
    await waitFor(() => expect(printRequests.length).toBe(2));
    expect(printRequests[1]).toEndWith("/api/print/thank-you");
    // Switch again before that delayed response resolves. The stale Thank-you
    // request must not be allowed to repopulate the Table-number iframe.
    fireEvent.click(screen.getByRole("button", { name: "Asztalszám" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Egzakt PDF előnézet" }).hasAttribute("disabled"),
      ).toBe(false),
    );
    expect(screen.queryByTitle("Egzakt PDF előnézet")).toBeNull();
  });
});
