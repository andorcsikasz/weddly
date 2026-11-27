// The "+" on /app/vendors. Three rules the flow depends on:
//
//   1. category comes FIRST: nothing is suggested until a category is picked,
//      so the couple never sees a list of vendors from every category at once;
//   2. suggestions are the directory's vendors in THAT category only, and a
//      vendor already on the plan says so instead of offering to add it twice;
//   3. the private-line fallback hands back the category the couple picked, so
//      the form opens already scoped to it.

import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { DirectorySupplier } from "@shared/suppliers";
import { I18nProvider } from "@/lib/i18n";

const { AddLineDialog } = await import("@/components/AddLineDialog");

function Providers({ children }: { children: ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

function supplier(
  over: Partial<DirectorySupplier> & Pick<DirectorySupplier, "id" | "name" | "category">,
): DirectorySupplier {
  return {
    city: "Budapest",
    country: "HU",
    blurb_hu: "",
    blurb_en: "",
    website: "",
    contact_email: null,
    has_contact_email: false,
    has_contact_phone: false,
    price_band: 2,
    votes_score: 0,
    ...over,
  } as DirectorySupplier;
}

const DIRECTORY: DirectorySupplier[] = [
  supplier({ id: "p1", name: "Lumen Studio", category: "photography", votes_score: 3 }),
  supplier({ id: "p2", name: "Blue Hour Foto", category: "photography", city: "Eger" }),
  supplier({ id: "v1", name: "Kúria Budán", category: "venue" }),
];

function renderDialog(props: Partial<Parameters<typeof AddLineDialog>[0]> = {}) {
  const handlers = {
    onClose: mock(() => {}),
    onUseExisting: mock(() => {}),
    onCreateNew: mock(() => {}),
    onRecommend: mock(() => {}),
  };
  render(
    <Providers>
      <AddLineDialog open directory={DIRECTORY} chosenIds={new Set()} {...handlers} {...props} />
    </Providers>,
  );
  return handlers;
}

describe("AddLineDialog", () => {
  it("asks for a category before suggesting any vendor", () => {
    renderDialog();
    expect(screen.queryByText("Lumen Studio")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Photography" }));
    expect(screen.getByText("Lumen Studio")).toBeTruthy();
    expect(screen.queryByText("Kúria Budán")).toBeNull();
  });

  it("filters suggestions by name or city within the chosen category", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Photography" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "eger" } });
    expect(screen.getByText("Blue Hour Foto")).toBeTruthy();
    expect(screen.queryByText("Lumen Studio")).toBeNull();
  });

  it("uses an existing vendor and marks one already on the plan", () => {
    const { onUseExisting } = renderDialog({ chosenIds: new Set(["p2"]) });
    fireEvent.click(screen.getByRole("button", { name: "Photography" }));
    expect(screen.getByText("On your plan")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    expect(onUseExisting).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }));
  });

  it("creates a private line already scoped to the category picked", () => {
    const { onCreateNew } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Photography" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a private Photography line" }));
    expect(onCreateNew).toHaveBeenCalledWith("photography");
  });

  it("hands the typed name and the chosen category to the recommend form", () => {
    const { onRecommend } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Photography" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "  Anna's Photo " } });
    fireEvent.click(screen.getByRole("button", { name: "Recommend it to Weddly" }));
    expect(onRecommend).toHaveBeenCalledWith({
      category: "photography",
      name: "Anna's Photo",
    });
  });
});
