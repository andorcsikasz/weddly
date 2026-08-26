import type { PhotoAlbum } from "@shared/types";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { CameraHero } from "@/pages/MediaPage";

const album: PhotoAlbum = {
  id: 1,
  uploadToken: "film-token",
  slug: "andor-and-sari",
  title: "Andor & Sári",
  shotsPerGuest: 24,
  revealAt: null,
  eventEndsAt: null,
  isUploadEnabled: true,
  allowGuestViewing: true,
  filmAesthetic: "warm",
  coverImageUrl: null,
  guestCap: 100,
  stripeTier: "free",
  paidAt: null,
  photoCount: 42,
  participantCount: 18,
  createdAt: Date.UTC(2026, 7, 1),
  updatedAt: Date.UTC(2026, 7, 2),
};

beforeEach(() => {
  localStorage.setItem("weddly.locale", "en");
});

describe("<CameraHero>", () => {
  it("explains the scan-to-shoot flow and opens film creation from the empty state", () => {
    const onCreate = mock(() => {});

    render(
      <I18nProvider>
        <CameraHero
          album={null}
          coupleName="Andor & Sári"
          coverPhoto="/demo/film-01.jpg"
          guestLinkUrl={null}
          onCreate={onCreate}
          onShare={() => {}}
        />
      </I18nProvider>,
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Collect every wedding memory in one place",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Share the QR code" }),
    ).toBeInTheDocument();
    expect(screen.getByText("No app needed for guests")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create Wedding Film" }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("keeps the live film's share and guest-preview actions prominent", () => {
    const onShare = mock(() => {});

    render(
      <I18nProvider>
        <CameraHero
          album={album}
          coupleName="Andor & Sári"
          coverPhoto="/demo/film-01.jpg"
          guestLinkUrl="https://tryweddly.com/photos/andor-and-sari"
          onCreate={() => {}}
          onShare={onShare}
        />
      </I18nProvider>,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Andor & Sári" })).toBeInTheDocument();
    expect(
      screen.getByText("Wedding Film is live. 42 photos captured so far."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Camera" })).toHaveAttribute(
      "href",
      "https://tryweddly.com/photos/andor-and-sari",
    );

    fireEvent.click(screen.getByRole("button", { name: "Share guest link" }));
    expect(onShare).toHaveBeenCalledTimes(1);
  });
});
