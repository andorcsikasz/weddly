import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppProviders } from "@/components/ui";
import { I18nProvider, _preloadHuForTests } from "@/lib/i18n";
import MediaPage from "@/pages/MediaPage";

const realFetch = globalThis.fetch;

beforeAll(async () => {
  await _preloadHuForTests();
});

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("weddly.locale", "hu");
  localStorage.setItem("weddly.token", "host-session");
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("<MediaPage> expired film reopening", () => {
  it("saves a future deadline and enables uploads as one action", async () => {
    const expiredAlbum = {
      id: 1,
      uploadToken: "film-token",
      slug: null,
      title: "Andor & Sári filmje",
      shotsPerGuest: 16,
      revealAt: Date.now() + 172_800_000,
      eventEndsAt: Date.now() - 86_400_000,
      isUploadEnabled: false,
      allowGuestViewing: true,
      filmAesthetic: "natural",
      coverImageUrl: null,
      guestCap: 15,
      stripeTier: "free",
      paidAt: null,
      photoCount: 0,
      participantCount: 0,
      createdAt: Date.now() - 100_000,
      updatedAt: Date.now() - 100_000,
    };
    const patches: Array<Record<string, unknown>> = [];

    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/couples/current") {
        return Promise.resolve(
          json({
            couple: {
              display_name: "Andor & Sári",
              bride_name: "Sári",
              groom_name: "Andor",
              wedding_date: "2026-08-08",
              media_links: { photographer: [] },
            },
          }),
        );
      }
      if (url === "/api/photo-albums/current" && method === "GET") {
        return Promise.resolve(json({ album: expiredAlbum }));
      }
      if (url === "/api/photo-albums/film-access") {
        return Promise.resolve(
          json({ access: { free: true, reason: null, priceEurCents: 0, checkoutEnabled: false } }),
        );
      }
      if (url === "/api/photo-albums/current/photos") {
        return Promise.resolve(json({ uploads: [], total: 0 }));
      }
      if (url === "/api/photo-albums/current" && method === "PATCH") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        patches.push(body);
        if ("event_ends_at" in body) {
          return Promise.resolve(
            json({ album: { ...expiredAlbum, eventEndsAt: body.event_ends_at as number } }),
          );
        }
        return Promise.resolve(
          json({
            album: {
              ...expiredAlbum,
              eventEndsAt: patches[0]?.event_ends_at as number,
              isUploadEnabled: true,
            },
          }),
        );
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    }) as unknown as typeof fetch;

    render(
      <I18nProvider>
        <AppProviders>
          <MemoryRouter initialEntries={["/app/media"]}>
            <MediaPage />
          </MemoryRouter>
        </AppProviders>
      </I18nProvider>,
    );

    const reopen = await screen.findByRole("button", { name: "Feltöltés újranyitása" });
    fireEvent.click(reopen);

    const deadline = await screen.findByLabelText("Film lezárása");
    fireEvent.change(deadline, { target: { value: "2099-01-01T12:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));

    await waitFor(() => expect(patches).toHaveLength(2));
    expect(patches[0]?.event_ends_at).toBe(new Date("2099-01-01T12:00").getTime());
    expect(patches[1]).toEqual({ is_upload_enabled: true });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Feltöltés lezárása" })).toBeInTheDocument(),
    );
  });
});
