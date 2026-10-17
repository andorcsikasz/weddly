import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from "fake-indexeddb";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { _resetOutboxForTests, listShots, putShot } from "@/lib/film_outbox";
import { I18nProvider, _preloadHuForTests } from "@/lib/i18n";
import GuestPhotoPage from "@/pages/GuestPhotoPage";

const realFetch = globalThis.fetch;
const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");

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
  if (originalMediaDevices) {
    Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
  } else {
    Reflect.deleteProperty(navigator, "mediaDevices");
  }
});

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("<GuestPhotoPage> host preview", () => {
  it("persists a first-time guest name on the device before opening the camera", async () => {
    const registrations: Array<{
      device_id: string;
      guest_name: string | null;
      email?: string | null;
    }> = [];
    globalThis.fetch = mock((_input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof init?.body === "string") {
        registrations.push(
          JSON.parse(init.body) as { device_id: string; guest_name: string | null },
        );
      }
      return Promise.resolve(
        response({
          album: {
            displayName: "Andor & Sári",
            weddingDate: "2026-08-08",
            slug: null,
            title: null,
            shotsPerGuest: 5,
            isUploadEnabled: true,
            eventEndsAt: null,
            revealAt: null,
            filmAesthetic: "natural",
            coverImageUrl: null,
          },
          shotCount: 0,
        }),
      );
    }) as unknown as typeof fetch;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });

    render(
      <I18nProvider>
        <MemoryRouter initialEntries={["/photos/new-guest-token"]}>
          <Routes>
            <Route path="/photos/:token" element={<GuestPhotoPage />} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Kamera megnyitása" })).toBeInTheDocument(),
    );
    expect(registrations).toHaveLength(1);
    expect(registrations[0]?.guest_name).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Kamera megnyitása" }));

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "A neved" })).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByRole("textbox", { name: "A neved" }), {
      target: { value: "  Nóra  " },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "E-mail-címed" }), {
      target: { value: "nora@guest.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mehet" }));

    await waitFor(() => expect(screen.getByText("A kamera ki van kapcsolva")).toBeInTheDocument());
    expect(registrations).toHaveLength(2);
    expect(registrations[1]).toMatchObject({
      device_id: registrations[0]?.device_id,
      guest_name: "Nóra",
      email: "nora@guest.test",
    });
    expect(localStorage.getItem("weddly.film.new-guest-token.name")).toBe("Nóra");
    expect(localStorage.getItem("weddly.film.new-guest-token.email")).toBe("nora@guest.test");
  });

  it("uses the authenticated read-only endpoint and never starts camera or guest mutations", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method ?? "GET" });
      return Promise.resolve(
        response({
          album: {
            displayName: "Andor & Sári",
            weddingDate: "2026-08-08",
            slug: null,
            title: null,
            shotsPerGuest: 5,
            // A closed live film must still have a useful host preview.
            isUploadEnabled: false,
            eventEndsAt: Date.now() - 1_000,
            revealAt: Date.now() + 86_400_000,
            filmAesthetic: "natural",
            coverImageUrl: null,
          },
          shotCount: 0,
          readOnly: true,
        }),
      );
    }) as unknown as typeof fetch;

    const getUserMedia = mock(() => Promise.reject(new Error("must not be called")));
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });

    render(
      <I18nProvider>
        <MemoryRouter initialEntries={["/photos/preview-token?preview=1"]}>
          <Routes>
            <Route path="/photos/:token" element={<GuestPhotoPage />} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Kamera megnyitása" })).toBeInTheDocument(),
    );
    expect(screen.getByText("Tulajdonosi előnézet · feltöltés kikapcsolva")).toBeInTheDocument();
    expect(requests).toEqual([{ url: "/api/photo-albums/preview-token/preview", method: "GET" }]);
    fireEvent.click(screen.getByRole("button", { name: "Kamera megnyitása" }));

    await waitFor(() => expect(screen.getByText("Hogy hívnak?")).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText("A neved"), { target: { value: "Andor" } });
    fireEvent.change(screen.getByPlaceholderText("E-mail-címed"), {
      target: { value: "andor@guest.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Kamera előnézete" }));

    await waitFor(() => expect(screen.getByText("Kamera-előnézet")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Fotó készítése" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Kép feltöltése" })).toBeDisabled();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1);
    expect(localStorage.getItem("weddly.film.preview-token.name")).toBeNull();
    expect(localStorage.getItem("weddly.film.preview-token.device_id")).toBeNull();
  });

  it("gives iPhone-specific HEIC guidance without sending the unsupported file", async () => {
    localStorage.setItem("weddly.film.live-token.name", "Anna");
    const requests: Array<{ url: string; method: string }> = [];
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method ?? "GET" });
      return Promise.resolve(
        response({
          album: {
            displayName: "Andor & Sári",
            weddingDate: "2026-08-08",
            slug: null,
            title: null,
            shotsPerGuest: 5,
            isUploadEnabled: true,
            eventEndsAt: null,
            revealAt: null,
            filmAesthetic: "natural",
            coverImageUrl: null,
          },
          shotCount: 0,
        }),
      );
    }) as unknown as typeof fetch;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });

    const { container } = render(
      <I18nProvider>
        <MemoryRouter initialEntries={["/photos/live-token"]}>
          <Routes>
            <Route path="/photos/:token" element={<GuestPhotoPage />} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByText("A kamera ki van kapcsolva")).toBeInTheDocument());
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    expect(input?.accept).toContain("image/heic");
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File([new Uint8Array([1, 2, 3])], "IMG_1234.HEIC")] },
    });

    await waitFor(() =>
      expect(
        screen.getByText(
          "A HEIC/HEIF képet még nem tudjuk feltölteni. Az iPhone Fotókban oszd meg vagy exportáld JPEG-ként, majd válaszd ki újra.",
        ),
      ).toBeInTheDocument(),
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toContain("/api/photo-albums/live-token/devices");
  });

  it("queues a second picked photo behind the first instead of blocking on it", async () => {
    localStorage.setItem("weddly.film.live-token.name", "Anna");
    const uploadCalls: number[] = [];
    let nextShotCount = 0;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/devices")) {
        return Promise.resolve(
          response({
            album: {
              displayName: "Andor & Sári",
              weddingDate: "2026-08-08",
              slug: null,
              title: null,
              shotsPerGuest: 5,
              isUploadEnabled: true,
              eventEndsAt: null,
              revealAt: null,
              filmAesthetic: "natural",
              coverImageUrl: null,
            },
            shotCount: 0,
          }),
        );
      }
      nextShotCount += 1;
      uploadCalls.push(nextShotCount);
      return Promise.resolve(
        response({ upload: { id: nextShotCount, fileUrl: "/x.jpg" }, shotCount: nextShotCount }),
      );
    }) as unknown as typeof fetch;
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });

    const { container } = render(
      <I18nProvider>
        <MemoryRouter initialEntries={["/photos/live-token"]}>
          <Routes>
            <Route path="/photos/:token" element={<GuestPhotoPage />} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByText("A kamera ki van kapcsolva")).toBeInTheDocument());
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');

    // Two picks fired back to back, with no await between them — the second
    // must not have to wait for the first's network round trip to resolve.
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File([new Uint8Array([1])], "a.jpg", { type: "image/jpeg" })] },
    });
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File([new Uint8Array([2])], "b.jpg", { type: "image/jpeg" })] },
    });

    // The per-shot toast confirms both were accepted rather than the second
    // silently overwriting the first. No full-screen sheet ever covers the lens.
    await waitFor(() => expect(screen.getByText(/Elküldve/)).toBeInTheDocument());
    expect(screen.queryByText("Megvan.")).toBeNull();
    await waitFor(() => expect(uploadCalls).toEqual([1, 2]));
  });

  it("retries a failed upload automatically and it eventually lands", async () => {
    localStorage.setItem("weddly.film.live-token.name", "Anna");
    let uploadAttempts = 0;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/devices")) {
        return Promise.resolve(
          response({
            album: {
              displayName: "Andor & Sári",
              weddingDate: "2026-08-08",
              slug: null,
              title: null,
              shotsPerGuest: 5,
              isUploadEnabled: true,
              eventEndsAt: null,
              revealAt: null,
              filmAesthetic: "natural",
              coverImageUrl: null,
            },
            shotCount: 0,
          }),
        );
      }
      uploadAttempts += 1;
      if (uploadAttempts === 1) {
        // No .status on this rejection — indistinguishable from fetch()
        // itself throwing because the guest briefly lost connectivity.
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      return Promise.resolve(response({ upload: { id: 1, fileUrl: "/x.jpg" }, shotCount: 1 }));
    }) as unknown as typeof fetch;
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });

    const { container } = render(
      <I18nProvider>
        <MemoryRouter initialEntries={["/photos/live-token"]}>
          <Routes>
            <Route path="/photos/:token" element={<GuestPhotoPage />} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByText("A kamera ki van kapcsolva")).toBeInTheDocument());
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File([new Uint8Array([1])], "a.jpg", { type: "image/jpeg" })] },
    });

    await waitFor(() => expect(screen.getByText(/Elküldve/)).toBeInTheDocument(), {
      timeout: 4000,
    });
    expect(uploadAttempts).toBe(2);
  });

  // shotCount 0 lands on the viewfinder (its queue restores the shot); 1
  // lands on "welcome back", which has no camera, so the page drains it.
  it.each([
    ["the viewfinder", 0],
    ["the welcome-back screen", 1],
  ])(
    "resends a shot an earlier visit left, from %s, then forgets it",
    async (_where, priorShots) => {
      const g = globalThis as unknown as { indexedDB?: unknown; IDBKeyRange?: unknown };
      const saved = { indexedDB: g.indexedDB, IDBKeyRange: g.IDBKeyRange };
      g.indexedDB = new IDBFactory();
      g.IDBKeyRange = FakeIDBKeyRange;
      _resetOutboxForTests();
      try {
        // The tab died with this shot still unsent, under the device id the
        // guest had back then.
        localStorage.setItem("weddly.film.live-token.name", "Anna");
        await putShot({
          id: "left-behind",
          token: "live-token",
          deviceId: "old-device",
          blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" }),
          createdAt: Date.now(),
        });
        _resetOutboxForTests();

        const uploads: FormData[] = [];
        globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url.endsWith("/photos") && init?.body instanceof FormData) {
            uploads.push(init.body);
            return Promise.resolve(
              new Response(
                JSON.stringify({ upload: { id: 7, fileUrl: "/uploads/x.jpg" }, shotCount: 1 }),
                {
                  status: 200,
                  headers: { "Content-Type": "application/json" },
                },
              ),
            );
          }
          return Promise.resolve(
            response({
              album: {
                displayName: "Andor & Sári",
                weddingDate: "2026-08-08",
                slug: null,
                title: null,
                shotsPerGuest: 5,
                isUploadEnabled: true,
                eventEndsAt: null,
                revealAt: null,
                filmAesthetic: "natural",
                coverImageUrl: null,
              },
              shotCount: priorShots,
            }),
          );
        }) as unknown as typeof fetch;
        Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });

        render(
          <I18nProvider>
            <MemoryRouter initialEntries={["/photos/live-token"]}>
              <Routes>
                <Route path="/photos/:token" element={<GuestPhotoPage />} />
              </Routes>
            </MemoryRouter>
          </I18nProvider>,
        );

        await waitFor(() => expect(uploads).toHaveLength(1));
        expect(uploads[0]?.get("client_shot_id")).toBe("left-behind");
        expect(uploads[0]?.get("device_id")).toBe("old-device");
        await waitFor(async () => expect(await listShots("live-token")).toEqual([]));
      } finally {
        g.indexedDB = saved.indexedDB;
        g.IDBKeyRange = saved.IDBKeyRange;
        _resetOutboxForTests();
      }
    },
  );

  // Reported 2026-10-17 with a screenshot: a guest who had already shot came
  // back before the reveal and got "still developing", no camera, while the
  // film's deadline was still ahead.
  it.each([
    [
      "before the deadline, a returning guest gets the camera back",
      Date.now() + 3_600_000,
      "Szia, Anna.",
    ],
    [
      "once the deadline passes, a guest who shot sees the countdown",
      Date.now() - 1_000,
      "Még előhívás alatt.",
    ],
  ])("%s", async (_case, eventEndsAt, heading) => {
    localStorage.setItem("weddly.film.live-token.name", "Anna");
    globalThis.fetch = mock(() =>
      Promise.resolve(
        response({
          album: {
            displayName: "Andor & Sári",
            weddingDate: "2027-09-05",
            slug: null,
            title: null,
            shotsPerGuest: 10,
            isUploadEnabled: true,
            eventEndsAt,
            // The reveal is still ahead in both cases: it decides when the
            // photos come out, never when shooting stops.
            revealAt: Date.now() + 86_400_000,
            filmAesthetic: "natural",
            coverImageUrl: null,
          },
          shotCount: 1,
        }),
      ),
    ) as unknown as typeof fetch;
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });

    render(
      <I18nProvider>
        <MemoryRouter initialEntries={["/photos/live-token"]}>
          <Routes>
            <Route path="/photos/:token" element={<GuestPhotoPage />} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByText(heading)).toBeInTheDocument());
  });
});
