import type { FilmUpload } from "@shared/types";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ConfirmDialogProvider } from "@/components/ui/ConfirmDialogProvider";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { I18nProvider } from "@/lib/i18n";
import { FilmGallery } from "@/pages/MediaPage";

function makeUploads(count: number): FilmUpload[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    guestName: index === 0 ? null : `Guest ${index + 1}`,
    fileUrl: `/photo-${index + 1}.jpg`,
    mimeType: "image/jpeg",
    filterApplied: null,
    uploadedAt: Date.UTC(2026, 7, 10 + index),
    source: index === 0 ? "couple" : "guest",
  }));
}

function renderGallery(
  count: number,
  onDeletePhoto: (photoId: number) => Promise<void> = async () => {},
) {
  return render(
    <I18nProvider>
      <ToastProvider>
        <ConfirmDialogProvider>
          <FilmGallery
            uploads={makeUploads(count)}
            aesthetic="natural"
            loading={false}
            onDeletePhoto={onDeletePhoto}
          />
        </ConfirmDialogProvider>
      </ToastProvider>
    </I18nProvider>,
  );
}

beforeEach(() => {
  localStorage.setItem("weddly.locale", "en");
});

describe("MediaPage FilmGallery accessibility", () => {
  it("gives content images contextual alt text and exposes contributor metadata", () => {
    renderGallery(2);

    expect(screen.getByRole("heading", { level: 3, name: "The film" })).toBeInTheDocument();
    expect(screen.getByAltText(/Photo 1, uploaded by You, 10 Aug 2026/i)).toBeInTheDocument();
    expect(screen.getByAltText(/Photo 2, uploaded by Guest 2, 11 Aug 2026/i)).toBeInTheDocument();
    expect(screen.getByText("Guest 2")).toBeInTheDocument();
    expect(screen.getByText("11 Aug 2026")).toBeInTheDocument();
  });

  it("deletes a photo from the lightbox after the couple confirms", async () => {
    const onDeletePhoto = mock(async () => {});
    renderGallery(2, onDeletePhoto);

    fireEvent.click(screen.getByRole("button", { name: /Photo 1, uploaded by You, 10 Aug 2026/i }));
    const dialog = screen.getByRole("dialog", { name: "Photo viewer" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete photo" }));

    const confirmDialog = await screen.findByRole("alertdialog", { name: "Delete photo" });
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(onDeletePhoto).toHaveBeenCalledWith(1));
    expect(await screen.findByText("Photo deleted")).toBeInTheDocument();
  });

  it("keeps a photo when the couple cancels the delete confirmation", async () => {
    const onDeletePhoto = mock(async () => {});
    renderGallery(2, onDeletePhoto);

    fireEvent.click(screen.getByRole("button", { name: /Photo 1, uploaded by You, 10 Aug 2026/i }));
    const dialog = screen.getByRole("dialog", { name: "Photo viewer" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete photo" }));

    const confirmDialog = await screen.findByRole("alertdialog", { name: "Delete photo" });
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByRole("alertdialog", { name: "Delete photo" })).not.toBeInTheDocument(),
    );
    expect(onDeletePhoto).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Photo viewer" })).toBeInTheDocument();
  });

  it("can expand and collapse the thumbnail preview", () => {
    renderGallery(13);

    expect(screen.getAllByRole("img")).toHaveLength(12);
    fireEvent.click(screen.getByRole("button", { name: "Show all 13" }));
    expect(screen.getAllByRole("img")).toHaveLength(13);

    const collapse = screen.getByRole("button", { name: "Show fewer" });
    expect(collapse).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(collapse);
    expect(screen.getAllByRole("img")).toHaveLength(12);
    expect(screen.getByRole("button", { name: "Show all 13" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("traps focus in the lightbox and restores it to the opening thumbnail", async () => {
    // happy-dom has no layout engine, while the shared modal shell deliberately
    // excludes zero-rect (display:none) controls. Give rendered elements one
    // synthetic rect so this test exercises the browser focus path.
    const realGetClientRects = Element.prototype.getClientRects;
    Element.prototype.getClientRects = () => [new DOMRect()] as unknown as DOMRectList;
    try {
      renderGallery(2);
      const opener = screen.getByRole("button", {
        name: /Photo 1, uploaded by You, 10 Aug 2026/i,
      });

      // fireEvent.click does not apply the browser's native click-focus step.
      opener.focus();
      fireEvent.click(opener);
      const dialog = screen.getByRole("dialog", { name: "Photo viewer" });
      const first = within(dialog).getByRole("link", { name: "Download" });
      expect(first).toHaveFocus();
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(document.body.style.overflow).toBe("hidden");
      expect(
        document.body.querySelector("#root") ?? document.body.firstElementChild,
      ).toHaveAttribute("inert");

      const last = within(dialog).getByRole("button", { name: "Next photo" });
      last.focus();
      fireEvent.keyDown(document, { key: "Tab" });
      expect(first).toHaveFocus();

      first.focus();
      fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
      expect(last).toHaveFocus();

      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("dialog", { name: "Photo viewer" })).not.toBeInTheDocument();
      expect(document.body.style.overflow).toBe("");
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      expect(opener).toHaveFocus();
    } finally {
      Element.prototype.getClientRects = realGetClientRects;
    }
  });
});
