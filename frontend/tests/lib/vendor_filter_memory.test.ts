import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import {
  isBareVisit,
  pickVendorFilters,
  readLocalVendorFilters,
  writeLocalVendorFilters,
} from "../../src/lib/vendor_filter_memory";

// The directory's filter set is restored only on a bare visit, and only the
// allowlisted keys are ever remembered. A deliberate link (a shared URL, a
// search, a saved-set chip) must never be rewritten under the couple.

describe("vendor filter memory", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("a bare visit is one with no filter, search or saved-set key", () => {
    expect(isBareVisit(new URLSearchParams(""))).toBe(true);
    expect(isBareVisit(new URLSearchParams("cat=venue"))).toBe(false);
    expect(isBareVisit(new URLSearchParams("q=kastely"))).toBe(false);
    expect(isBareVisit(new URLSearchParams("picked=1"))).toBe(false);
  });

  test("picks only the remembered keys off the URL", () => {
    const picked = pickVendorFilters(
      new URLSearchParams("group=venue_stay&cat=venue&city=Eger&q=kastely&view=map"),
    );
    expect(picked).toEqual({ group: "venue_stay", cat: "venue", city: "Eger" });
  });

  test("round-trips through localStorage", () => {
    writeLocalVendorFilters({ remember: true, filters: { cat: "venue" } });
    expect(readLocalVendorFilters()).toEqual({ remember: true, filters: { cat: "venue" } });
  });

  test("opting out reads back as remember:false with nothing kept", () => {
    writeLocalVendorFilters({ remember: false, filters: null });
    expect(readLocalVendorFilters()).toEqual({ remember: false, filters: null });
  });

  test("a corrupted stored value reads as nothing, not a crash", () => {
    window.localStorage.setItem("weddly.vendors.filters", "{not json");
    expect(readLocalVendorFilters()).toBeNull();
  });

  test("stored values outside the allowlist are dropped on read", () => {
    window.localStorage.setItem(
      "weddly.vendors.filters",
      JSON.stringify({ remember: true, filters: { cat: "venue", admin: "1", city: "<b>x</b>" } }),
    );
    expect(readLocalVendorFilters()).toEqual({ remember: true, filters: { cat: "venue" } });
  });
});
