// The venue-name typeahead's matcher. Pure function, so this pins the rules
// that decide whether a couple is offered the listing they are about to
// hand-copy: folding (accents, legal forms), the three-character floor, and the
// ranking that puts a name starting with the query above one merely containing
// it.

import { describe, expect, it } from "bun:test";
import { useState } from "react";
import { suggestByName } from "@/components/SupplierNameAutocomplete";

const VENUES = [
  { id: "a", name: "Sári Csárda", city: "Dunakiliti" },
  { id: "b", name: "Hertelendy Kastély Kft.", city: "Kozmapuszta" },
  { id: "c", name: "Zichy Park Hotel", city: "Kalocsa" },
  { id: "d", name: "Kastélyszálló Fenyőharaszt", city: "Verseg" },
  { id: "e", name: "Normafa Rendezvényház", city: "Budapest" },
];

describe("suggestByName", () => {
  it("finds an accented name from an unaccented query", () => {
    // The whole point of folding: nobody types "Sári" with the accent on a
    // phone keyboard, and the couple should still be offered the listing.
    expect(suggestByName("sari", VENUES).map((v) => v.id)).toEqual(["a"]);
  });

  it("ignores the legal form, so the same business matches either way", () => {
    expect(suggestByName("hertelendy kastely kft", VENUES).map((v) => v.id)).toEqual(["b"]);
    expect(suggestByName("hertelendy", VENUES).map((v) => v.id)).toEqual(["b"]);
  });

  it("ranks a name that STARTS with the query above one that contains it", () => {
    // Both contain "kastely"; only one starts with it. Without the tiers this
    // is decided by the alphabet, which is not an answer to what was typed.
    const ids = suggestByName("kastely", VENUES).map((v) => v.id);
    expect(ids[0]).toBe("d");
    expect(ids).toContain("b");
  });

  it("says nothing under three characters", () => {
    // A suggestion list that opens on "sa" is a list of everything, and it
    // covers the field the couple is still typing into.
    expect(suggestByName("sa", VENUES)).toEqual([]);
    expect(suggestByName("", VENUES)).toEqual([]);
    expect(suggestByName("sar", VENUES).length).toBe(1);
  });

  it("returns nothing rather than everything when there is no match", () => {
    expect(suggestByName("nonexistent venue", VENUES)).toEqual([]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: `x${i}`,
      name: `Kastely ${i}`,
      city: "Budapest",
    }));
    expect(suggestByName("kastely", many).length).toBeLessThanOrEqual(6);
  });
});

// The rendered control. The matcher above is only half the feature: the list
// has to open on typing, offer the listing, and hand it back on a pick.

import { fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { SupplierNameAutocomplete } from "@/components/SupplierNameAutocomplete";

function Harness({ onPick }: { onPick: (v: { id: string }) => void }) {
  const [value, setValue] = useState("");
  return (
    <I18nProvider>
      <SupplierNameAutocomplete
        id="venue-name"
        label="Helyszín neve"
        value={value}
        options={VENUES}
        onChange={setValue}
        onPick={onPick}
      />
    </I18nProvider>
  );
}

describe("SupplierNameAutocomplete", () => {
  it("opens on typing, lists the matching listings, and hands one back", async () => {
    const picked: string[] = [];
    render(<Harness onPick={(v) => picked.push(v.id)} />);

    const input = screen.getByRole("combobox");
    expect(input.getAttribute("aria-expanded")).toBe("false");

    fireEvent.change(input, { target: { value: "hertelendy" } });
    const options = await screen.findAllByRole("option");
    expect(options.length).toBe(1);
    expect(options[0]?.textContent).toContain("Hertelendy Kastély");
    // The town rides along, because two venues can share a name.
    expect(options[0]?.textContent).toContain("Kozmapuszta");

    fireEvent.pointerDown(options[0] as HTMLElement);
    expect(picked).toEqual(["b"]);
  });

  it("stays closed under the character floor", () => {
    render(<Harness onPick={() => {}} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "he" } });
    expect(screen.queryAllByRole("option").length).toBe(0);
  });

  it("never blocks a name the directory does not have", () => {
    // The couple must always be able to type their own venue: the suggestions
    // are an accelerator, and this form's whole purpose is the venues we lack.
    const picked: string[] = [];
    render(<Harness onPick={(v) => picked.push(v.id)} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "Nagyi kertje" } });
    expect(screen.queryAllByRole("option").length).toBe(0);
    expect((input as HTMLInputElement).value).toBe("Nagyi kertje");
    expect(picked).toEqual([]);
  });
});
