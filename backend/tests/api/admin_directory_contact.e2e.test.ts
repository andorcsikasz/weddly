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
import type { SupplierDirectoryAdminRow } from "@shared/suppliers";
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

async function directory(token: string, query: string) {
  const r = await req<{ suppliers: SupplierDirectoryAdminRow[] }>(
    "GET",
    `/api/admin/suppliers/directory${query}`,
    undefined,
    { token },
  );
  expect(r.status).toBe(200);
  return r.data.suppliers;
}

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
