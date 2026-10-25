// The vendor's printable review QR code (Hovercode, faked by HOVERCODE_FAKE=1).
// What must hold: one code per listing however often the vendor taps, it lands
// on their own public page with the composer open, a rename re-points it rather
// than breaking printed copies, and only the vendor themselves can reach it.

import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import type { VendorReviewQrView } from "@shared/vendor_review_qr";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";
import { db } from "../../src/db";
import { _fakeHovercode } from "../../src/lib/hovercode";
import { createVendorListing } from "../../src/domain/listings";
import { createVendorAccount } from "../../src/domain/vendor_accounts";

beforeEach(() => {
  wipeAll();
  _fakeHovercode.reset();
});

async function seedVendor(email: string, name: string) {
  const reg = await registerAndVerify({
    email,
    password: "supersafe123",
    full_name: "Vendor Owner",
  });
  const userId = reg.data.user.id;
  db.prepare("UPDATE users SET role = 'vendor', couple_id = NULL WHERE id = ?").run(userId);
  const account = createVendorAccount({
    ownerUserId: userId,
    displayName: name,
    contactEmail: email,
    onboardingDone: false,
  });
  createVendorListing({
    vendorAccountId: account.id,
    category: "photography",
    name,
    city: "Szeged",
    contactEmail: email,
  });
  return { id: `v${account.id}`, token: reg.data.token as string };
}

const path = "/api/vendor/review-qr/me";

describe("vendor review QR code", () => {
  test("none until asked for, then exactly one however often the vendor taps", async () => {
    const { id, token } = await seedVendor("qr-once@weddly.test", "Golden Lens");
    const before = await req<VendorReviewQrView>("GET", path, undefined, { token });
    expect(before.status).toBe(200);
    expect(before.data).toEqual({ available: true, qr: null });

    const [a, b] = await Promise.all([
      req<VendorReviewQrView>("POST", path, {}, { token }),
      req<VendorReviewQrView>("POST", path, {}, { token }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(_fakeHovercode.created).toBe(1);
    expect(a.data.qr?.shortlink_url).toBe("https://qrr.to/fake-1");
    expect(a.data.qr?.target_url).toContain(`/suppliers/`);
    expect(a.data.qr?.target_url).toContain(id);
    expect(a.data.qr?.target_url.endsWith("?review=1")).toBe(true);
    expect(a.data.qr?.scans_30d).toBe(3);

    const again = await req<VendorReviewQrView>("POST", path, {}, { token });
    expect(again.data.qr?.shortlink_url).toBe("https://qrr.to/fake-1");
    expect(_fakeHovercode.created).toBe(1);
  });

  test("a renamed listing re-points the printed code instead of making a new one", async () => {
    const { id, token } = await seedVendor("qr-rename@weddly.test", "Golden Lens");
    const made = await req<VendorReviewQrView>("POST", path, {}, { token });
    const first = made.data.qr?.target_url;
    db.prepare("UPDATE listings SET name = ? WHERE id = ?").run("Silver Frame Studio", id);

    const view = await req<VendorReviewQrView>("GET", path, undefined, { token });
    expect(view.data.qr?.target_url).not.toBe(first);
    expect(view.data.qr?.target_url).toContain("silver-frame-studio");
    expect(_fakeHovercode.targets.get("fake-1")).toBe(view.data.qr?.target_url);
    expect(_fakeHovercode.created).toBe(1);
  });

  test("the code is drawn as a same-origin SVG once it exists", async () => {
    const { token } = await seedVendor("qr-svg@weddly.test", "Golden Lens");
    const base = `http://localhost:${process.env.PORT ?? "8791"}`;
    const get = () =>
      fetch(`${base}${path}.svg`, { headers: { Authorization: `Bearer ${token}` } });
    const missing = await get();
    await missing.body?.cancel();
    expect(missing.status).toBe(404);
    await req("POST", path, {}, { token });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("image/svg+xml");
    expect((await res.text()).trimStart()).toStartWith("<svg");
  });

  test("only vendors reach it", async () => {
    const couple = await bootstrapCouple();
    const r = await req("POST", path, {}, { token: couple.token });
    expect(r.status).toBe(403);
    expect(_fakeHovercode.created).toBe(0);
  });
});
