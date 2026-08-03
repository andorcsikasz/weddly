// AI Concierge — the assistant strip on the vendor's client detail.
//
// Runs entirely on the AI_FAKE=1 stub pinned in tests/setup.ts: not one request
// in this file reaches Anthropic. What is under test is the pipeline around the
// model, which is where every product decision actually lives — the PRO gate,
// the per-account rate limit, the "never invent a price" coercion, and the
// promise that a bad model minute is a non-event rather than a 500.
//
// Pairs with backend/src/routes/ai_assist.ts + domain/ai_assist.ts + lib/ai.ts.

import "../setup";

import { describe, expect, test } from "bun:test";
import type { AiAvailability, InquiryAssistResult } from "@shared/ai_assist";
import type { SupplierBooking } from "@shared/suppliers";
import { db } from "../../src/db";
import { coerceAssistOutput } from "../../src/domain/ai_assist";
import { createVerificationToken } from "../../src/domain/community_suppliers";
import { initVendorBilling } from "../../src/domain/vendor_billing";
import { aiLastFakeRequest, resetAiLastFakeRequest } from "../../src/lib/ai";
import {
  bootstrapCouple,
  enableBillingEnforcement,
  registerAndVerify,
  req,
  wipeAll,
} from "../helpers";

const ASSIST_PATH = (bookingId: number) => `/api/vendor/clients/${bookingId}/ai-assist`;

// ─── Bootstrap (same shape as vendor_clients.e2e.test.ts) ───────────────────

async function adminToken(): Promise<string> {
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Ádám Nagy",
  });
  if (reg.status === 201) return reg.data.token;
  const login = await req<{ token: string }>("POST", "/api/auth/login", {
    email: "admin@test.test",
    password: "supersafe123",
  });
  return login.data.token;
}

async function makeApprovedListing(
  ownerEmail: string,
  contactEmail: string,
  name: string,
): Promise<string> {
  const { token } = await bootstrapCouple(ownerEmail);
  const submit = await req<{ supplier: { id: string } }>(
    "POST",
    "/api/suppliers/community",
    {
      category: "photography",
      submitter_type: "self",
      name,
      city: "Budapest",
      address: null,
      website: `https://${name.toLowerCase().replace(/\s+/g, "-")}.example`,
      contact_email: contactEmail,
      contact_phone: null,
      blurb: `${name} — blurb`,
      price_band: 3,
    },
    { token },
  );
  expect(submit.status).toBe(201);
  const publicId = submit.data.supplier.id;
  const numericId = Number(publicId.slice(1));

  createVerificationToken(numericId);
  const vtok = db
    .prepare(
      "SELECT token FROM community_supplier_verifications WHERE supplier_id = ? ORDER BY id DESC LIMIT 1",
    )
    .get(numericId) as { token: string } | undefined;
  await req("POST", `/api/suppliers/community/verify/${vtok?.token}`, {});

  const at = await adminToken();
  const approve = await req("POST", `/api/admin/suppliers/${numericId}/approve`, {}, { token: at });
  expect(approve.status).toBe(200);
  return publicId;
}

async function claimListing(
  listingId: string,
  contactEmail: string,
  fullName: string,
): Promise<string> {
  const start = await req("POST", "/api/vendor/claim/start", {
    listing_id: listingId,
    claimant_email: "claimer@gmail.test",
  });
  expect(start.status).toBe(200);
  const claim = db
    .prepare(
      "SELECT token FROM listing_claims WHERE listing_id = ? AND email_sent_to = ? ORDER BY id DESC LIMIT 1",
    )
    .get(listingId, contactEmail) as { token: string } | undefined;
  await req("POST", `/api/vendor/claim/verify/${claim?.token}`, {});
  const complete = await req<{ token: string }>("POST", "/api/vendor/claim/complete", {
    token: claim?.token,
    password: "vendorpass123",
    full_name: fullName,
  });
  expect(complete.status).toBe(201);
  return complete.data.token;
}

async function bootstrapVendor(
  slug: string,
): Promise<{ vendorToken: string; listingId: string; accountId: number }> {
  const listingId = await makeApprovedListing(
    `owner-${slug}@weddly.test`,
    `vendor-${slug}@weddly.test`,
    `${slug} Studio`,
  );
  const vendorToken = await claimListing(listingId, `vendor-${slug}@weddly.test`, `Vendor ${slug}`);
  const acct = db
    .prepare("SELECT vendor_account_id AS id FROM listings WHERE id = ?")
    .get(listingId) as { id: number };
  return { vendorToken, listingId, accountId: acct.id };
}

async function createInboundBooking(
  listingId: string,
  coupleId: number,
  eventDate: string,
  notes: string,
): Promise<number> {
  const at = await adminToken();
  const r = await req<SupplierBooking>(
    "POST",
    `/api/suppliers/${encodeURIComponent(listingId)}/bookings`,
    { couple_id: coupleId, event_date: eventDate, notes },
    { token: at },
  );
  expect(r.status).toBe(201);
  return r.data.id;
}

/** Save packages on the vendor's own listing, straight into the table the
 *  editor writes — this suite is about the assistant, not the package CRUD. */
function savePackages(
  listingId: string,
  names: { name: string; price: string | null }[],
): number[] {
  const ids: number[] = [];
  for (const p of names) {
    const info = db
      .prepare(
        `INSERT INTO listing_packages (listing_id, name, price_text, description, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?)`,
      )
      .run(listingId, p.name, p.price, Date.now(), Date.now());
    ids.push(Number(info.lastInsertRowid));
  }
  return ids;
}

/** A full PRO vendor with one inbound inquiry, ready to assist. */
async function scenario(slug: string, notes = "We are getting married, can you shoot it?") {
  const { vendorToken, listingId, accountId } = await bootstrapVendor(slug);
  initVendorBilling(accountId, "EUR");
  const { coupleId } = await bootstrapCouple(`couple-${slug}@weddly.test`);
  const bookingId = await createInboundBooking(listingId, coupleId, "2030-06-20", notes);
  return { vendorToken, listingId, accountId, coupleId, bookingId };
}

// ─── Availability ───────────────────────────────────────────────────────────

describe("ai concierge: availability", () => {
  test("reports available when an Anthropic key is configured", async () => {
    const r = await req<AiAvailability>("GET", "/api/ai/availability");
    expect(r.status).toBe(200);
    expect(r.data.available).toBe(true);
  });

  test("reports unavailable with no key, which is what hides the whole strip", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "";
    try {
      const r = await req<AiAvailability>("GET", "/api/ai/availability");
      expect(r.status).toBe(200);
      expect(r.data.available).toBe(false);
    } finally {
      process.env.ANTHROPIC_API_KEY = saved ?? "";
    }
  });
});

// ─── Gating ─────────────────────────────────────────────────────────────────

describe("ai concierge: gating", () => {
  test("requires auth", async () => {
    wipeAll();
    const r = await req("POST", ASSIST_PATH(1), {});
    expect(r.status).toBe(401);
  });

  test("a FREE vendor is refused with 403", async () => {
    wipeAll();
    enableBillingEnforcement();
    const { vendorToken, listingId, accountId } = await bootstrapVendor("ai-free");
    const { coupleId } = await bootstrapCouple("couple-ai-free@weddly.test");
    // The inquiry lands while the claim-complete activation grant is still
    // live, THEN the vendor lapses to FREE — the same shape as the payment
    // paywall test, and the only state a free vendor can hold an inquiry in.
    const bookingId = await createInboundBooking(listingId, coupleId, "2030-06-20", "Hello");
    db.prepare(
      "UPDATE vendor_subscriptions SET subscription_status = 'none', founding_until = NULL, is_founding_member = 0 WHERE vendor_account_id = ?",
    ).run(accountId);

    const r = await req<{ detail?: { code?: string } }>(
      "POST",
      ASSIST_PATH(bookingId),
      {},
      {
        token: vendorToken,
      },
    );
    expect(r.status).toBe(403);
    // And the refusal was the paywall, not a stray ownership check.
    expect(r.data.detail?.code).toBe("vendor_pro_required");
  });

  test("another vendor's inquiry is a 404, never a 403", async () => {
    wipeAll();
    const mine = await scenario("ai-mine");
    const theirs = await bootstrapVendor("ai-theirs");
    initVendorBilling(theirs.accountId, "EUR");

    const r = await req("POST", ASSIST_PATH(mine.bookingId), {}, { token: theirs.vendorToken });
    expect(r.status).toBe(404);
  });

  test("503 when no key is configured, and the answer names the reason", async () => {
    wipeAll();
    const { vendorToken, bookingId } = await scenario("ai-nokey");
    const saved = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "";
    try {
      const r = await req<{ code?: string }>(
        "POST",
        ASSIST_PATH(bookingId),
        {},
        {
          token: vendorToken,
        },
      );
      expect(r.status).toBe(503);
    } finally {
      process.env.ANTHROPIC_API_KEY = saved ?? "";
    }
  });

  test("the rate limit bites, per vendor account", async () => {
    wipeAll();
    const { vendorToken, bookingId } = await scenario("ai-limit");
    // AI_ASSIST_BUCKET capacity is 6. Seven calls in a row must not all pass:
    // the model call is on our bill and the account is who spends it.
    let sawLimit = false;
    for (let i = 0; i < 9; i++) {
      const r = await req("POST", ASSIST_PATH(bookingId), {}, { token: vendorToken });
      if (r.status === 429) {
        sawLimit = true;
        break;
      }
      expect(r.status).toBe(200);
    }
    expect(sawLimit).toBe(true);
  });
});

// ─── The answer ─────────────────────────────────────────────────────────────

describe("ai concierge: the answer", () => {
  test("summarises, drafts, and suggests one of the vendor's OWN packages", async () => {
    wipeAll();
    const { vendorToken, listingId, bookingId } = await scenario("ai-answer");
    const ids = savePackages(listingId, [
      { name: "Full-day package", price: "450 000 Ft-tól" },
      { name: "Premium package", price: null },
    ]);

    const r = await req<InquiryAssistResult>(
      "POST",
      ASSIST_PATH(bookingId),
      {},
      {
        token: vendorToken,
      },
    );
    expect(r.status).toBe(200);
    expect(r.data.generated).toBe(true);
    const assist = r.data.assist;
    expect(assist).toBeTruthy();
    expect(assist?.summary.length).toBeGreaterThan(0);
    expect(assist?.draft_reply.length).toBeGreaterThan(0);
    // What the couple did NOT say is half the point of the summary.
    expect(assist?.missing.length).toBeGreaterThan(0);
    expect(assist?.no_packages).toBe(false);
    // The suggestion names a row the vendor actually saved, and quotes THEIR
    // price text verbatim — the server copied both off the row.
    expect(ids).toContain(assist?.package?.package_id ?? -1);
    expect(assist?.package?.name).toBe("Full-day package");
    expect(assist?.package?.price_text).toBe("450 000 Ft-tól");
  });

  test("a vendor with zero saved packages gets a suggestion-free answer", async () => {
    wipeAll();
    const { vendorToken, bookingId } = await scenario("ai-nopkg");

    const r = await req<InquiryAssistResult>(
      "POST",
      ASSIST_PATH(bookingId),
      {},
      {
        token: vendorToken,
      },
    );
    expect(r.status).toBe(200);
    expect(r.data.generated).toBe(true);
    expect(r.data.assist?.package).toBeNull();
    // Said in words rather than left as a silent gap, so the strip can tell the
    // vendor why there is no suggestion instead of implying there is nothing to
    // suggest.
    expect(r.data.assist?.no_packages).toBe(true);
  });

  test("the output language follows the couple, not the vendor", async () => {
    wipeAll();
    const { vendorToken, bookingId, coupleId } = await scenario("ai-lang");
    // The couple signed up through the Hungarian interface.
    db.prepare(
      "UPDATE users SET locale = 'hu' WHERE id = (SELECT partner_a_id FROM couples WHERE id = ?)",
    ).run(coupleId);

    const r = await req<InquiryAssistResult>(
      "POST",
      ASSIST_PATH(bookingId),
      {},
      {
        token: vendorToken,
      },
    );
    expect(r.status).toBe(200);
    expect(r.data.assist?.language).toBe("hu");
    // And the instruction actually carried it.
    expect(aiLastFakeRequest()?.system).toContain("Hungarian");
  });

  test("a model failure degrades to an empty answer, never a 500", async () => {
    wipeAll();
    const { vendorToken, bookingId } = await scenario("ai-fail");
    process.env.AI_FAKE_FAIL = "1";
    try {
      const r = await req<InquiryAssistResult>(
        "POST",
        ASSIST_PATH(bookingId),
        {},
        {
          token: vendorToken,
        },
      );
      expect(r.status).toBe(200);
      expect(r.data.generated).toBe(false);
      expect(r.data.assist).toBeNull();
    } finally {
      process.env.AI_FAKE_FAIL = "";
    }
  });
});

// ─── Privacy ────────────────────────────────────────────────────────────────

describe("ai concierge: the couple's data does not leave for no reason", () => {
  test("the payload carries no email, no phone and no name", async () => {
    wipeAll();
    resetAiLastFakeRequest();
    const { vendorToken, listingId, bookingId, coupleId } = await scenario(
      "ai-privacy",
      "Looking for a photographer for the whole day.",
    );
    savePackages(listingId, [{ name: "Full-day package", price: "450 000 Ft-tól" }]);
    // Give the couple a phone number on the workspace, so its absence from the
    // prompt is a real result rather than an artefact of it never existing.
    db.prepare("UPDATE couples SET venue_phone = '+36 30 111 2222' WHERE id = ?").run(coupleId);

    const r = await req<InquiryAssistResult>(
      "POST",
      ASSIST_PATH(bookingId),
      {},
      {
        token: vendorToken,
      },
    );
    expect(r.status).toBe(200);

    const sent = aiLastFakeRequest();
    expect(sent).toBeTruthy();
    const payload = `${sent?.system ?? ""}\n${sent?.user ?? ""}`;

    // The couple's login address, their partner names, and their phone.
    expect(payload).not.toContain("couple-ai-privacy@weddly.test");
    expect(payload).not.toContain("@weddly.test");
    expect(payload).not.toContain("Mia & Lucas");
    expect(payload).not.toContain("Mia");
    expect(payload).not.toContain("Lucas");
    expect(payload).not.toContain("+36 30 111 2222");
    // The vendor's own PRICE TEXT is withheld too — that is what makes "never
    // invents a price" true by construction: the model is never shown one.
    expect(payload).not.toContain("450 000 Ft-tól");

    // And what IS sent is the five permitted facts.
    expect(payload).toContain("2030-06-20");
    expect(payload).toContain("Guest count: 80");
    expect(payload).toContain("photography");
    expect(payload).toContain("Full-day package");
    expect(payload).toContain("Looking for a photographer for the whole day.");
  });
});

// ─── The trust boundary, directly ───────────────────────────────────────────

describe("ai concierge: coerceAssistOutput never lets the model invent", () => {
  const pkg = {
    id: 7,
    name: "Full-day package",
    price_text: "450 000 Ft-tól",
    description: null,
    pdf_url: null,
    pdf_name: null,
  };
  const ctx = { language: "en" as const, packagesById: new Map([[7, pkg]]) };

  test("a hallucinated package id is dropped, not repaired", () => {
    const out = coerceAssistOutput(
      {
        summary: "A June wedding for 80 guests.",
        missing: ["no venue"],
        draft_reply: "Thanks for getting in touch.",
        package_id: 999,
        package_reason: "Best value at 199 000 Ft.",
      },
      ctx,
    );
    expect(out).toBeTruthy();
    expect(out?.package).toBeNull();
  });

  test("a package the vendor saved keeps the vendor's OWN name and price", () => {
    const out = coerceAssistOutput(
      {
        summary: "A June wedding for 80 guests.",
        missing: [],
        draft_reply: "Thanks for getting in touch.",
        // The model tries to hand back a name and a price of its own. Neither
        // is even read: name and price_text come off the row.
        package_id: 7,
        package_reason: "Covers the whole day.",
        name: "Diamond package",
        price_text: "99 000 Ft",
      },
      ctx,
    );
    expect(out?.package?.name).toBe("Full-day package");
    expect(out?.package?.price_text).toBe("450 000 Ft-tól");
    expect(out?.package?.reason).toBe("Covers the whole day.");
  });

  test("an id arriving as a string still has to name a real row", () => {
    const hit = coerceAssistOutput(
      { summary: "s", missing: [], draft_reply: "d", package_id: "7", package_reason: "r" },
      ctx,
    );
    expect(hit?.package?.package_id).toBe(7);
    const miss = coerceAssistOutput(
      { summary: "s", missing: [], draft_reply: "d", package_id: "999", package_reason: "r" },
      ctx,
    );
    expect(miss?.package).toBeNull();
  });

  test("an unusable answer is null rather than a half-built one", () => {
    expect(coerceAssistOutput(null, ctx)).toBeNull();
    expect(coerceAssistOutput("not an object", ctx)).toBeNull();
    expect(coerceAssistOutput({ summary: "", draft_reply: "x" }, ctx)).toBeNull();
    expect(coerceAssistOutput({ summary: "x", draft_reply: "   " }, ctx)).toBeNull();
  });

  test("missing is capped and de-junked", () => {
    const out = coerceAssistOutput(
      {
        summary: "s",
        draft_reply: "d",
        missing: ["a", "", "  ", "b", 42, "c", "d", "e", "f"],
        package_id: null,
        package_reason: null,
      },
      ctx,
    );
    expect(out?.missing).toEqual(["a", "b", "c", "d"]);
  });

  test("no saved packages is reported as such", () => {
    const out = coerceAssistOutput(
      { summary: "s", draft_reply: "d", missing: [], package_id: 7, package_reason: "r" },
      { language: "hu", packagesById: new Map() },
    );
    expect(out?.no_packages).toBe(true);
    expect(out?.package).toBeNull();
    expect(out?.language).toBe("hu");
  });
});
