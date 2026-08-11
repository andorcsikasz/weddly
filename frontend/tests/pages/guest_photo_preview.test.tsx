import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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

    await waitFor(() => expect(screen.getByText("Hogy hívnak?")).toBeInTheDocument());
    expect(screen.getByText("Tulajdonosi előnézet · feltöltés kikapcsolva")).toBeInTheDocument();
    expect(requests).toEqual([{ url: "/api/photo-albums/preview-token/preview", method: "GET" }]);

    fireEvent.change(screen.getByPlaceholderText("A neved"), { target: { value: "Andor" } });
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
});
