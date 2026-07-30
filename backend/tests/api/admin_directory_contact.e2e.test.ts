// The admin directory's contact filter: "no email" narrows to the listings no
// outbound flow can reach.
//
// This is the state a scraped batch arrives in — Google Maps publishes a phone
// and a website, never an address — and it decides whether a listing can ever
// be offered to its owner, since the claim-invite campaign mails
// `contact_email`. Without the filter those rows are invisible among a
// thousand others.

import "../setup";

import { describe, expect, test } from "bun:test";
import type {
  AdminDirectoryFacets,
  DirectoryGap,
  SupplierDirectoryAdminRow,
} from "@shared/suppliers";
import { registerAndVerify, req, wipeAll } from "../helpers";

async function adminToken(): Promise<string> {
  wipeAll();
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Admin",
  });
  return reg.data.token;
}

async function fetchDirectory(token: string, query: string) {
  const r = await req<{ suppliers: SupplierDirectoryAdminRow[]; facets: AdminDirectoryFacets }>(
    "GET",
    `/api/admin/suppliers/directory${query}`,
    undefined,
    { token },
  );
  expect(r.status).toBe(200);
  return r.data;
}

async function directory(token: string, query: string) {
  return (await fetchDirectory(token, query)).suppliers;
}

/** The row-side reading of a gap, written out independently of the server's so
 *  the test is checking the rule rather than restating the implementation. */
const HAS_GAP: Record<DirectoryGap, (r: SupplierDirectoryAdminRow) => boolean> = {
  no_email: (r) => !r.contact_email?.trim(),
  no_phone: (r) => !r.contact_phone?.trim(),
  no_website: (r) => !r.website?.trim(),
  no_hero: (r) => !r.hero_image_url?.trim(),
};

describe("admin directory — contact filter", () => {
  test("no_email returns exactly the listings with no contact address", async () => {
    const token = await adminToken();

    const all = await directory(token, "");
    const noEmail = await directory(token, "?contact=no_email");

    expect(all.length).toBeGreaterThan(0);
    // Every returned row really lacks an email...
    expect(noEmail.every((r) => !r.contact_email)).toBe(true);
    // ...and none of the email-less rows in the full set were left out.
    const expected = all.filter((r) => !r.contact_email).length;
    expect(noEmail.length).toBe(expected);
    expect(noEmail.length).toBeGreaterThan(0); // the curated batch is full of them
  });

  test("the filter composes with the others rather than replacing them", async () => {
    const token = await adminToken();
    const venuesNoEmail = await directory(token, "?contact=no_email&category=venue");
    expect(venuesNoEmail.every((r) => r.category === "venue" && !r.contact_email)).toBe(true);

    // An unknown value is ignored, same as every other filter in this parser.
    const bogus = await directory(token, "?contact=nonsense");
    const all = await directory(token, "");
    expect(bogus.length).toBe(all.length);
  });

  test("a listing WITH an email is excluded", async () => {
    const token = await adminToken();
    const withEmail = (await directory(token, "")).find((r) => r.contact_email);
    expect(withEmail).toBeDefined();
    const noEmail = await directory(token, "?contact=no_email");
    expect(noEmail.some((r) => r.id === withEmail?.id)).toBe(false);
  });
});

describe("admin directory — gap toggles", () => {
  test("each gap returns exactly the rows missing that field", async () => {
    const token = await adminToken();
    const all = await directory(token, "");

    for (const gap of ["no_email", "no_phone", "no_website", "no_hero"] as DirectoryGap[]) {
      const rows = await directory(token, `?gaps=${gap}`);
      expect(rows.every(HAS_GAP[gap])).toBe(true);
      expect(rows.length).toBe(all.filter(HAS_GAP[gap]).length);
    }
  });

  test("several gaps AND together: the truly unreachable set", async () => {
    const token = await adminToken();
    const all = await directory(token, "");
    const both = await directory(token, "?gaps=no_email,no_phone");

    // AND, not OR: every row is missing BOTH, which is what makes this list
    // "nobody can contact these" rather than "something is missing somewhere".
    expect(both.every((r) => HAS_GAP.no_email(r) && HAS_GAP.no_phone(r))).toBe(true);
    expect(both.length).toBe(all.filter((r) => HAS_GAP.no_email(r) && HAS_GAP.no_phone(r)).length);
    // And it is a subset of either one alone.
    const emailOnly = await directory(token, "?gaps=no_email");
    expect(both.length).toBeLessThanOrEqual(emailOnly.length);
  });

  test("the legacy contact param is folded in, and does not double-narrow", async () => {
    const token = await adminToken();
    const legacy = await directory(token, "?contact=no_email");
    const modern = await directory(token, "?gaps=no_email");
    const both = await directory(token, "?contact=no_email&gaps=no_email");
    expect(modern.length).toBe(legacy.length);
    expect(both.length).toBe(legacy.length);
  });

  test("an unknown gap name is dropped, not an error", async () => {
    const token = await adminToken();
    const all = await directory(token, "");
    // A stale link should still show a list an admin can work with.
    expect((await directory(token, "?gaps=nonsense")).length).toBe(all.length);
    // A junk name alongside a real one leaves the real one working.
    expect((await directory(token, "?gaps=nonsense,no_email")).length).toBe(
      all.filter(HAS_GAP.no_email).length,
    );
  });

  test("gaps compose with the other filters", async () => {
    const token = await adminToken();
    const rows = await directory(token, "?gaps=no_email&category=venue&source=curated");
    expect(
      rows.every((r) => r.category === "venue" && r.source === "curated" && HAS_GAP.no_email(r)),
    ).toBe(true);
  });
});

describe("admin directory — facet counts", () => {
  test("counts match what the matching filter actually returns", async () => {
    const token = await adminToken();
    const { facets, suppliers } = await fetchDirectory(token, "");
    expect(facets.base_total).toBe(suppliers.length);
    for (const gap of ["no_email", "no_phone", "no_website", "no_hero"] as DirectoryGap[]) {
      expect(facets.gaps[gap]).toBe((await directory(token, `?gaps=${gap}`)).length);
    }
  });

  test("a gap count is measured BEFORE the gap toggles, so a chip never counts itself", async () => {
    const token = await adminToken();
    const open = await fetchDirectory(token, "");
    const narrowed = await fetchDirectory(token, "?gaps=no_email");

    // The rows narrowed; the counts did not, because they answer "how many
    // would this give me" and not "how many are left". Without this the numbers
    // collapse into the result total the moment one chip is on.
    expect(narrowed.suppliers.length).toBe(open.facets.gaps.no_email);
    expect(narrowed.facets.gaps).toEqual(open.facets.gaps);
    expect(narrowed.facets.base_total).toBe(open.facets.base_total);
  });

  test("but a NON-gap filter does narrow the counts", async () => {
    const token = await adminToken();
    const open = await fetchDirectory(token, "");
    const venues = await fetchDirectory(token, "?category=venue");
    expect(venues.facets.base_total).toBeLessThan(open.facets.base_total);
    expect(venues.facets.gaps.no_email).toBeLessThanOrEqual(open.facets.gaps.no_email);
    // And it still agrees with the list that filter produces.
    expect(venues.facets.gaps.no_email).toBe(
      (await directory(token, "?category=venue&gaps=no_email")).length,
    );
  });
});
