// Cross-tenant IDOR sweep — the broad counterpart to probe B in
// audit_50_user_probe.e2e.test.ts, which only covered guests + budget lines.
//
// Shape: seed ONE row of every couple-scoped aggregate in couple A, then drive
// every id-taking endpoint with couple B's bearer token and assert B is refused.
// The same sweep runs for vendor-vs-vendor, and for role confusion (a couple
// token against /api/vendor/*, /api/planner/*, /api/admin/*).
//
// Why a table rather than one test per endpoint: the interesting failure is a
// NEW endpoint shipped without scoping, so the value is in breadth. Adding an
// aggregate = one entry in SEEDS + its probes.
//
// The assertion is deliberately two-sided:
//   1. the status is a refusal (401/403/404/400), never 2xx, and
//   2. the response body does not contain A's marker string.
// (2) catches the subtler bug where a handler 200s with an empty-ish envelope
// that still carries the victim's label.

import "../setup";

import { describe, expect, test } from "bun:test";
import { db } from "../../src/db";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";
import { createVerificationToken } from "../../src/domain/community_suppliers";
import { initVendorBilling } from "../../src/domain/vendor_billing";

const MARKER = "ZZTENANTLEAKMARKER";
const TIMEOUT = 60_000;

interface Probe {
  method: string;
  path: string;
  body?: unknown;
  /** See expectRefused: this handler scopes the write by the caller's own
   *  parent id, so a foreign id is a silent no-op rather than a 404. */
  noopOk?: boolean;
}

/** A refusal. 400 counts because some handlers validate the id shape before
 *  ownership and a foreign id can fail that first; what must never happen is a
 *  2xx, or any body carrying the victim's marker.
 *
 *  `allowNoopOk` covers the idempotent-DELETE handlers (vendor listing media /
 *  packages): they scope the DELETE by the caller's OWN listing id, so a
 *  foreign id deletes nothing and they return 200 with the caller's own view
 *  rather than 404. That is a no-op, not a leak — but the body must still be
 *  free of the victim's marker, and the survival assertions at the end of each
 *  test are what actually prove nothing was destroyed. */
function expectRefused(status: number, raw: string, label: string, allowNoopOk = false): void {
  if (status >= 200 && status < 300 && !allowNoopOk) {
    throw new Error(`LEAK: ${label} returned ${status} to the wrong tenant — body: ${raw}`);
  }
  if (raw.includes(MARKER)) {
    throw new Error(`LEAK: ${label} returned ${status} but leaked the victim marker: ${raw}`);
  }
}

async function probe(p: Probe, token: string, label: string): Promise<void> {
  const r = await req<unknown>(p.method, p.path, p.body, { token });
  expectRefused(
    r.status,
    JSON.stringify(r.data ?? ""),
    `${label} ${p.method} ${p.path}`,
    p.noopOk === true,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Couple A vs couple B.
// ─────────────────────────────────────────────────────────────────────────────

interface SeededIds {
  guestId: number;
  householdId: number;
  lineId: number;
  paymentId: number;
  planningId: number;
  scheduleId: number;
  tableId: number;
  wishlistId: number;
  incomeId: number;
  accommodationId: number;
  transferId: number;
  supplierId: number;
  giftId: number;
  coupleId: number;
}

async function create<T>(path: string, body: unknown, token: string): Promise<T> {
  const r = await req<T>("POST", path, body, { token });
  if (r.status !== 200 && r.status !== 201) {
    throw new Error(`seed failed for ${path}: ${r.status} ${JSON.stringify(r.data)}`);
  }
  return r.data;
}

async function seedCouple(token: string, coupleId: number): Promise<SeededIds> {
  const guest = await create<{ guest: { id: number } }>(
    "/api/guests",
    { full_name: `${MARKER} Guest` },
    token,
  );
  const household = await create<{ household: { id: number } }>(
    "/api/households",
    { label: `${MARKER} Household` },
    token,
  );
  const line = await create<{ line: { id: number } }>(
    "/api/budget/lines",
    { category: "other", label: `${MARKER} Line`, planned_huf: 100_000 },
    token,
  );
  const payment = await create<{ payment: { id: number } }>(
    "/api/budget/payments",
    { scope: `line:${line.line.id}`, amount_huf: 1000, note: MARKER },
    token,
  );
  const planning = await create<{ item: { id: number } }>(
    "/api/planning",
    { kind: "task", title: `${MARKER} Task` },
    token,
  );
  const schedule = await create<{ event: { id: number } }>(
    "/api/schedule",
    { label: `${MARKER} Ceremony`, starts_at_minutes: 16 * 60 },
    token,
  );
  const table = await create<{ table: { id: number } }>(
    "/api/seating/tables",
    { label: `${MARKER} T1`, shape: "round", seats: 4, x_mm: 0, y_mm: 0 },
    token,
  );
  const wish = await create<{ item: { id: number } }>(
    "/api/wishlist",
    { title: `${MARKER} Gift` },
    token,
  );
  const income = await create<{ income: { id: number } }>(
    "/api/income",
    { label: `${MARKER} Income`, amount_huf: 50_000 },
    token,
  );
  const accommodation = await create<{ accommodation: { id: number } }>(
    "/api/accommodations",
    { name: `${MARKER} Hotel` },
    token,
  );
  const transfer = await create<{ transfer: { id: number } }>(
    "/api/transfers",
    { label: `${MARKER} Bus`, depart_at_minutes: 10 * 60 },
    token,
  );
  const supplier = await create<{ supplier: { id: number } }>(
    "/api/couple-suppliers",
    { name: `${MARKER} Florist`, category: "venue" },
    token,
  );
  const gift = await create<{ item: { id: number } }>(
    "/api/received-gifts",
    { title: `${MARKER} Vase` },
    token,
  );

  return {
    guestId: guest.guest.id,
    householdId: household.household.id,
    lineId: line.line.id,
    paymentId: payment.payment.id,
    planningId: planning.item.id,
    scheduleId: schedule.event.id,
    tableId: table.table.id,
    wishlistId: wish.item.id,
    incomeId: income.income.id,
    accommodationId: accommodation.accommodation.id,
    transferId: transfer.transfer.id,
    supplierId: supplier.supplier.id,
    giftId: gift.item.id,
    coupleId,
  };
}

function coupleProbes(a: SeededIds): Probe[] {
  const rename = { label: "hijacked", title: "hijacked", name: "hijacked" };
  return [
    { method: "GET", path: `/api/guests/${a.guestId}` },
    { method: "PATCH", path: `/api/guests/${a.guestId}`, body: { full_name: "hijacked" } },
    { method: "DELETE", path: `/api/guests/${a.guestId}` },

    { method: "PATCH", path: `/api/households/${a.householdId}`, body: rename },
    { method: "DELETE", path: `/api/households/${a.householdId}` },
    { method: "POST", path: `/api/households/${a.householdId}/rotate-code` },

    { method: "PATCH", path: `/api/budget/lines/${a.lineId}`, body: { planned_huf: 1 } },
    { method: "DELETE", path: `/api/budget/lines/${a.lineId}` },

    { method: "PATCH", path: `/api/budget/payments/${a.paymentId}`, body: { amount_huf: 1 } },
    { method: "DELETE", path: `/api/budget/payments/${a.paymentId}` },
    { method: "GET", path: `/api/budget/payments/${a.paymentId}/download` },

    { method: "PATCH", path: `/api/planning/${a.planningId}`, body: rename },
    { method: "DELETE", path: `/api/planning/${a.planningId}` },

    { method: "PATCH", path: `/api/schedule/${a.scheduleId}`, body: rename },
    { method: "DELETE", path: `/api/schedule/${a.scheduleId}` },

    { method: "PATCH", path: `/api/seating/tables/${a.tableId}`, body: rename },
    { method: "DELETE", path: `/api/seating/tables/${a.tableId}` },

    { method: "PATCH", path: `/api/wishlist/${a.wishlistId}`, body: rename },
    { method: "DELETE", path: `/api/wishlist/${a.wishlistId}` },

    { method: "PATCH", path: `/api/income/${a.incomeId}`, body: { amount_huf: 1 } },
    { method: "DELETE", path: `/api/income/${a.incomeId}` },

    { method: "PATCH", path: `/api/accommodations/${a.accommodationId}`, body: rename },
    { method: "DELETE", path: `/api/accommodations/${a.accommodationId}` },

    { method: "PATCH", path: `/api/transfers/${a.transferId}`, body: rename },
    { method: "DELETE", path: `/api/transfers/${a.transferId}` },

    { method: "GET", path: `/api/couple-suppliers/${a.supplierId}` },
    { method: "PATCH", path: `/api/couple-suppliers/${a.supplierId}`, body: rename },
    { method: "DELETE", path: `/api/couple-suppliers/${a.supplierId}` },

    { method: "PATCH", path: `/api/received-gifts/${a.giftId}`, body: rename },
    { method: "DELETE", path: `/api/received-gifts/${a.giftId}` },

    // The workspace itself, and the couple-scoped singletons addressed by id.
    { method: "DELETE", path: `/api/couples/${a.coupleId}` },
    { method: "POST", path: `/api/couples/${a.coupleId}/activate` },
  ];
}

describe("cross-tenant IDOR — couple A vs couple B", () => {
  test(
    "no couple-scoped endpoint answers to the wrong workspace",
    async () => {
      wipeAll();
      const a = await bootstrapCouple("idor-a@weddly.test");
      const b = await bootstrapCouple("idor-b@weddly.test");
      const seeded = await seedCouple(a.token, a.coupleId);

      for (const p of coupleProbes(seeded)) {
        await probe(p, b.token, "couple-B→A");
      }

      // And anonymously — no token at all.
      for (const p of coupleProbes(seeded)) {
        const r = await req<unknown>(p.method, p.path, p.body);
        expectRefused(r.status, JSON.stringify(r.data ?? ""), `anon ${p.method} ${p.path}`);
      }

      // A's own rows survived every probe: nothing was deleted or renamed.
      const guest = db.prepare("SELECT full_name FROM guests WHERE id = ?").get(seeded.guestId) as
        | { full_name: string }
        | undefined;
      expect(guest?.full_name).toContain(MARKER);
      const line = db.prepare("SELECT label FROM budget_lines WHERE id = ?").get(seeded.lineId) as
        | { label: string }
        | undefined;
      expect(line?.label).toContain(MARKER);
    },
    TIMEOUT,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Vendor A vs vendor B. Bootstrap mirrors vendor_tasks.e2e.test.ts.
// ─────────────────────────────────────────────────────────────────────────────

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

async function bootstrapVendor(
  slug: string,
): Promise<{ vendorToken: string; listingId: string; accountId: number }> {
  const { token } = await bootstrapCouple(`vowner-${slug}@weddly.test`);
  const contactEmail = `vendor-${slug}@weddly.test`;
  const submit = await req<{ supplier: { id: string } }>(
    "POST",
    "/api/suppliers/community",
    {
      category: "photography",
      submitter_type: "self",
      name: `Idor Studio ${slug}`,
      city: "Budapest",
      address: null,
      website: `https://idor-${slug}.example`,
      contact_email: contactEmail,
      contact_phone: null,
      blurb: `Idor ${slug} blurb`,
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

  const start = await req("POST", "/api/vendor/claim/start", {
    listing_id: publicId,
    claimant_email: `claimer-${slug}@gmail.test`,
  });
  expect(start.status).toBe(200);
  const claim = db
    .prepare(
      "SELECT token FROM listing_claims WHERE listing_id = ? AND email_sent_to = ? ORDER BY id DESC LIMIT 1",
    )
    .get(publicId, contactEmail) as { token: string } | undefined;
  await req("POST", `/api/vendor/claim/verify/${claim?.token}`, {});
  const complete = await req<{ token: string }>("POST", "/api/vendor/claim/complete", {
    token: claim?.token,
    password: "vendorpass123",
    full_name: `Vendor ${slug}`,
  });
  expect(complete.status).toBe(201);
  const accountRow = db.prepare("SELECT id FROM vendor_accounts ORDER BY id DESC LIMIT 1").get() as
    | { id: number }
    | undefined;
  return {
    vendorToken: complete.data.token,
    listingId: publicId,
    accountId: accountRow?.id ?? 0,
  };
}

describe("cross-tenant IDOR — vendor A vs vendor B", () => {
  test(
    "a vendor cannot read or mutate another vendor's private work",
    async () => {
      wipeAll();
      const vA = await bootstrapVendor("a");
      const vB = await bootstrapVendor("b");

      const task = await create<{ task: { id: number } }>(
        "/api/vendor/tasks",
        { title: `${MARKER} Vendor task` },
        vA.vendorToken,
      );
      // The package create returns the whole listing view, not the row, so read
      // the new id back from the table.
      const pkg = await req(
        "POST",
        "/api/vendor/listing/me/packages",
        { name: `${MARKER} Package`, price_text: "1000" },
        { token: vA.vendorToken },
      );
      const pkgRow = db.prepare("SELECT id FROM listing_packages ORDER BY id DESC LIMIT 1").get() as
        | { id: number }
        | undefined;

      const probes: Probe[] = [
        { method: "PATCH", path: `/api/vendor/tasks/${task.task.id}`, body: { title: "hijack" } },
        { method: "DELETE", path: `/api/vendor/tasks/${task.task.id}` },
      ];
      if (pkg.status === 201 && pkgRow) {
        probes.push(
          {
            method: "PATCH",
            path: `/api/vendor/listing/me/packages/${pkgRow.id}`,
            body: { name: "hijack" },
          },
          { method: "DELETE", path: `/api/vendor/listing/me/packages/${pkgRow.id}`, noopOk: true },
        );
      }

      for (const p of probes) await probe(p, vB.vendorToken, "vendor-B→A");

      // A's task is untouched.
      const row = db.prepare("SELECT title FROM vendor_tasks WHERE id = ?").get(task.task.id) as
        | { title: string }
        | undefined;
      expect(row?.title).toContain(MARKER);
      // And so is A's package — the DELETE that answered 200 deleted nothing,
      // because it is scoped by the CALLER's listing id.
      if (pkgRow) {
        const survived = db
          .prepare("SELECT name FROM listing_packages WHERE id = ?")
          .get(pkgRow.id) as { name: string } | undefined;
        expect(survived?.name).toContain(MARKER);
      }
    },
    TIMEOUT,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// The CORRESPONDENCE aggregate — an inquiry and everything that hangs off it:
// the message thread, the quote, the date hold. It is addressed by a booking id
// from BOTH sides (the vendor at /api/vendor/clients/:id/*, the couple at
// /api/messages/threads/:bookingId/*), which is exactly the shape this sweep
// exists for, and it is also the newest and the only one carrying a price.
//
// A quote is the moment a vendor commits to a number and a couple accepts one,
// so a leak here is not a privacy problem alone: `accept` writes
// `contract_value` and confirms the booking, which is a stranger signing a
// contract between two other parties.
// ─────────────────────────────────────────────────────────────────────────────

/** A claimed PRO vendor, an onboarded couple, and one live inquiry between
 *  them. The inquiry comes from an outreach campaign because that is the path
 *  that produces a real booking with a real thread behind it. */
async function seedThread(slug: string): Promise<{
  vendorToken: string;
  coupleToken: string;
  bookingId: number;
  quoteId: number;
}> {
  const vendor = await bootstrapVendor(slug);
  // Quotes and holds are PRO writes; the free plan would refuse them with a 402
  // and the probe could not tell a paywall from a scoping check.
  initVendorBilling(vendor.accountId, "EUR");

  const couple = await bootstrapCouple(`thread-${slug}@weddly.test`);
  const sent = await req(
    "POST",
    "/api/outreach/campaigns",
    {
      subject: `${MARKER} Sept 12`,
      body_template: `${MARKER} Are you free?`,
      supplier_ids: [vendor.listingId],
    },
    { token: couple.token },
  );
  expect(sent.status).toBe(201);

  const clients = await req<{ clients: Array<{ id: number }> }>(
    "GET",
    "/api/vendor/clients",
    undefined,
    { token: vendor.vendorToken },
  );
  expect(clients.status).toBe(200);
  const bookingId = clients.data.clients[0]?.id;
  if (!bookingId) throw new Error(`seedThread(${slug}): no booking behind the outreach`);

  const quote = await req<{ quote: { id: number } }>(
    "POST",
    `/api/vendor/clients/${bookingId}/quotes`,
    {
      title: `${MARKER} Coverage`,
      lines: [{ label: `${MARKER} Full day`, unit_amount: 1200, qty: 1 }],
    },
    { token: vendor.vendorToken },
  );
  expect(quote.status).toBe(201);

  return {
    vendorToken: vendor.vendorToken,
    coupleToken: couple.token,
    bookingId,
    quoteId: quote.data.quote.id,
  };
}

describe("cross-tenant IDOR — one inquiry's thread, quote and date hold", () => {
  test(
    "neither the wrong vendor nor the wrong couple can reach another pair's correspondence",
    async () => {
      wipeAll();
      const a = await seedThread("ca");
      const b = await seedThread("cb");

      // CONTROL. A refusal sweep passes vacuously if a path is misspelled: the
      // 404 that proves nothing looks exactly like the 404 that proves
      // everything. So first confirm the RIGHT tokens do reach these routes.
      // If one of these stops answering, the probes below are measuring air.
      for (const [method, path, token, who] of [
        ["GET", `/api/vendor/clients/${a.bookingId}`, a.vendorToken, "vendor"],
        ["GET", `/api/vendor/clients/${a.bookingId}/messages`, a.vendorToken, "vendor"],
        ["GET", `/api/vendor/clients/${a.bookingId}/quotes`, a.vendorToken, "vendor"],
        ["GET", `/api/vendor/clients/${a.bookingId}/hold`, a.vendorToken, "vendor"],
        ["GET", `/api/messages/threads/${a.bookingId}`, a.coupleToken, "couple"],
        ["GET", `/api/messages/threads/${a.bookingId}/quotes`, a.coupleToken, "couple"],
      ] as const) {
        const own = await req<unknown>(method, path, undefined, { token });
        if (own.status < 200 || own.status >= 300) {
          throw new Error(
            `CONTROL FAILED: ${who} A got ${own.status} on its OWN ${method} ${path} — ` +
              "the refusal probes below prove nothing until this answers.",
          );
        }
      }

      // Vendor B against vendor A's client. `/api/vendor/clients/:id/*` keys on
      // a booking id, so an unscoped handler here hands over another studio's
      // lead, their thread with that couple, and the number they quoted.
      const vendorProbes: Probe[] = [
        { method: "GET", path: `/api/vendor/clients/${a.bookingId}` },
        { method: "GET", path: `/api/vendor/clients/${a.bookingId}/messages` },
        {
          method: "POST",
          path: `/api/vendor/clients/${a.bookingId}/messages`,
          body: { body: "hijacked" },
        },
        { method: "POST", path: `/api/vendor/clients/${a.bookingId}/messages/seen` },
        { method: "GET", path: `/api/vendor/clients/${a.bookingId}/quotes` },
        {
          method: "POST",
          path: `/api/vendor/clients/${a.bookingId}/quotes`,
          body: { title: "hijacked", lines: [{ label: "x", unit_amount: 1, qty: 1 }] },
        },
        { method: "GET", path: `/api/vendor/clients/${a.bookingId}/hold` },
        {
          method: "PUT",
          path: `/api/vendor/clients/${a.bookingId}/hold`,
          body: { hold_until: Date.now() + 86_400_000 },
        },
        { method: "DELETE", path: `/api/vendor/clients/${a.bookingId}/hold` },
        { method: "PATCH", path: `/api/vendor/quotes/${a.quoteId}`, body: { title: "hijacked" } },
        { method: "POST", path: `/api/vendor/quotes/${a.quoteId}/send` },
        { method: "POST", path: `/api/vendor/quotes/${a.quoteId}/withdraw` },
        { method: "DELETE", path: `/api/vendor/quotes/${a.quoteId}` },
      ];
      for (const p of vendorProbes) await probe(p, b.vendorToken, "vendor-B→A thread");

      // Couple B against couple A's thread. `accept` is the sharp one: it
      // writes contract_value and confirms the booking, so a stranger reaching
      // it signs a contract between two other parties.
      const coupleProbes: Probe[] = [
        { method: "GET", path: `/api/messages/threads/${a.bookingId}` },
        {
          method: "POST",
          path: `/api/messages/threads/${a.bookingId}`,
          body: { body: "hijacked" },
        },
        { method: "POST", path: `/api/messages/threads/${a.bookingId}/seen` },
        { method: "GET", path: `/api/messages/threads/${a.bookingId}/quotes` },
        { method: "POST", path: `/api/quotes/${a.quoteId}/accept` },
        { method: "POST", path: `/api/quotes/${a.quoteId}/decline`, body: { reason: "hijacked" } },
      ];
      for (const p of coupleProbes) await probe(p, b.coupleToken, "couple-B→A thread");

      // A's quote is still A's: same title, still a draft nobody sent, still
      // carrying no accepted contract value.
      const quoteRow = db
        .prepare(
          "SELECT title, sent_at, accepted_at, withdrawn_at FROM booking_quotes WHERE id = ?",
        )
        .get(a.quoteId) as
        | {
            title: string;
            sent_at: number | null;
            accepted_at: number | null;
            withdrawn_at: number | null;
          }
        | undefined;
      expect(quoteRow?.title).toContain(MARKER);
      expect(quoteRow?.sent_at).toBeNull();
      expect(quoteRow?.accepted_at).toBeNull();
      expect(quoteRow?.withdrawn_at).toBeNull();

      // Nobody wrote into A's thread, and no hold was placed on A's booking.
      const hijacked = db
        .prepare("SELECT COUNT(*) AS n FROM booking_messages WHERE booking_id = ? AND body LIKE ?")
        .get(a.bookingId, "%hijacked%") as { n: number };
      expect(hijacked.n).toBe(0);
      const holds = db
        .prepare("SELECT COUNT(*) AS n FROM booking_date_holds WHERE booking_id = ?")
        .get(a.bookingId) as { n: number };
      expect(holds.n).toBe(0);
    },
    TIMEOUT,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Role confusion — a plain couple token must not reach vendor / planner / admin
// surfaces, and a vendor token must not reach the couple workspace.
// ─────────────────────────────────────────────────────────────────────────────

describe("role confusion", () => {
  test(
    "a couple token is refused by every vendor, planner and admin surface",
    async () => {
      wipeAll();
      const couple = await bootstrapCouple("role-couple@weddly.test");

      const forbidden = [
        "/api/vendor/account",
        "/api/vendor/listing/me",
        "/api/vendor/clients",
        "/api/vendor/stats",
        "/api/vendor/tasks",
        "/api/vendor/availability/me",
        "/api/vendor/billing/status",
        "/api/planner/clients",
        "/api/planner/events",
        "/api/planner/profile",
        "/api/planner/billing/status",
        "/api/admin/users",
        "/api/admin/couples",
        "/api/admin/vendors",
        "/api/admin/planners",
        "/api/admin/analytics/overview",
        "/api/admin/email-list",
        "/api/admin/feedback",
      ];

      for (const path of forbidden) {
        const r = await req<unknown>("GET", path, undefined, { token: couple.token });
        if (r.status >= 200 && r.status < 300) {
          throw new Error(`LEAK: couple token got ${r.status} from ${path}`);
        }
      }
    },
    TIMEOUT,
  );
});
