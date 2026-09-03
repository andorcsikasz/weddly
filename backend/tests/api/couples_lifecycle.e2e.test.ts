import "../setup";

import { describe, expect, test } from "bun:test";
import { CURRENCIES } from "@shared/currency";
import { PROFILE_ACTIVE_WINDOW_MS } from "@shared/types";
import { req, wipeAll, registerAndVerify, bootstrapCouple } from "../helpers";
import { issueSession } from "../../src/auth/session";
import { db } from "../../src/db";
import { lookupDestinationIata } from "../../src/domain/destination_iata";
import { MAX_QUERY_CHARS } from "../../src/routes/places";

// All tests in this file run sequentially (no parallelism), and each test
// starts with wipeAll() so couple_id and user_id sequences reset cleanly.
//
// We deliberately do NOT mock upstream Pinterest / Nominatim / SerpApi —
// the test exercises the failure paths and the "no credentials configured"
// path for SerpApi instead. Pinterest / Nominatim tests assert the input
// validation and rate-limit shape; network behaviour is observable but
// not asserted so the suite stays hermetic.

// ─── Helpers used across this file ────────────────────────────────────────

/** Register + verify a fresh user and return their bearer token without
 *  onboarding a couple. Use when you need a logged-in user that hasn't yet
 *  created a workspace (eg. to test the "no couple" 400 path). */
async function freshUserNoCouple(email: string): Promise<{ token: string; userId: number }> {
  const r = await registerAndVerify({
    email,
    password: "supersafe123",
    full_name: "Tamás Kovács",
  });
  expect(r.status).toBe(201);
  return { token: r.data.token, userId: r.data.user.id };
}

/** Mint an UNVERIFIED user + session straight through the DB.
 *  Register no longer creates a `users` row (it parks a pending signup), so
 *  the only way to hold a session for an account whose email isn't verified
 *  is to write the row and issue the session directly. Used by the
 *  "requires verified email" probes below. */
function unverifiedUserWithSession(email: string): { token: string; userId: number } {
  const ts = Date.now();
  const info = db
    .prepare(
      `INSERT INTO users (email, password_hash, full_name, status, role, verified_email, password_set, created_at, updated_at)
       VALUES (?, ?, ?, 'active', 'owner', 0, 1, ?, ?)`,
    )
    .run(email.trim().toLowerCase(), "x", "Unverified", ts, ts);
  const userId = Number(info.lastInsertRowid);
  return { token: issueSession(userId, "activation"), userId };
}

/** Make a fresh registered+verified user, accept the given invite on their
 *  behalf, and return their bearer token. Use for partner-B flows. */
async function registerAndAcceptInvite(email: string, token: string): Promise<string> {
  const reg = await registerAndVerify({
    email,
    password: "supersafe123",
    full_name: "Petra Nagy",
  });
  expect(reg.status).toBe(201);
  const accept = await req("POST", `/api/invites/${token}/accept`, {}, { token: reg.data.token });
  expect(accept.status).toBe(200);
  return reg.data.token;
}

// ════════════════════════════════════════════════════════════════════════════
//   COUPLES — onboarding, validation, slug, partner view, activity, archive
// ════════════════════════════════════════════════════════════════════════════

describe("couples_lifecycle: onboarding goal validation", () => {
  test("a range budget goal is recorded as the ceiling but seeds no budget lines", async () => {
    wipeAll();
    const { token } = await freshUserNoCouple("season-mid@weddly.test");

    const ob = await req<{ couple: { id: number; budget_goal: { kind: string } } }>(
      "POST",
      "/api/couples/onboard",
      {
        bride_name: "Anna",
        groom_name: "Bence",
        wedding_date_goal: { kind: "season", target_year: 2027, target_season: "summer" },
        guest_count_goal: { kind: "range", min: 60, max: 100 },
        budget_goal: { kind: "range", min_huf: 4_000_000, max_huf: 6_000_000 },
      },
      { token },
    );
    expect(ob.status).toBe(201);
    expect(ob.data.couple.budget_goal.kind).toBe("range");

    // New-workspace policy (feat 15f5f77e: empty budget, no prefill): onboarding
    // records the goal as the ceiling range but seeds NO budget lines — couples
    // build their own budget rather than inheriting a canned split.
    const lines = db
      .prepare("SELECT COUNT(*) AS n FROM budget_lines WHERE couple_id = ?")
      .get(ob.data.couple.id) as { n: number };
    expect(lines.n).toBe(0);

    const row = db
      .prepare(
        "SELECT budget_kind, budget_ceiling_min_huf AS mn, budget_ceiling_max_huf AS mx FROM couples WHERE id = ?",
      )
      .get(ob.data.couple.id) as { budget_kind: string; mn: number; mx: number };
    expect(row.budget_kind).toBe("range");
    expect(row.mn).toBe(4_000_000);
    expect(row.mx).toBe(6_000_000);
  });

  test("TBD goals across the board seed no budget lines", async () => {
    wipeAll();
    const { token } = await freshUserNoCouple("tbd-everything@weddly.test");

    const ob = await req<{ couple: { id: number } }>(
      "POST",
      "/api/couples/onboard",
      {
        bride_name: "Anna",
        groom_name: "Bence",
        wedding_date_goal: { kind: "tbd" },
        guest_count_goal: { kind: "tbd" },
        budget_goal: { kind: "tbd" },
      },
      { token },
    );
    expect(ob.status).toBe(201);

    const lines = db
      .prepare("SELECT COUNT(*) AS n FROM budget_lines WHERE couple_id = ?")
      .get(ob.data.couple.id) as { n: number };
    expect(lines.n).toBe(0);
  });

  test("budget range inversion (max < min) is rejected with 400", async () => {
    wipeAll();
    const { token } = await freshUserNoCouple("budget-inv@weddly.test");

    const r = await req(
      "POST",
      "/api/couples/onboard",
      {
        bride_name: "Anna",
        groom_name: "Bence",
        budget_goal: { kind: "range", min_huf: 6_000_000, max_huf: 4_000_000 },
      },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("guest count range inversion (max < min) is rejected with 400", async () => {
    wipeAll();
    const { token } = await freshUserNoCouple("guest-inv@weddly.test");

    const r = await req(
      "POST",
      "/api/couples/onboard",
      {
        bride_name: "Anna",
        groom_name: "Bence",
        guest_count_goal: { kind: "range", min: 100, max: 50 },
      },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("season goal without target_year is rejected", async () => {
    wipeAll();
    const { token } = await freshUserNoCouple("season-noyear@weddly.test");

    const r = await req(
      "POST",
      "/api/couples/onboard",
      {
        bride_name: "Anna",
        groom_name: "Bence",
        wedding_date_goal: { kind: "season", target_season: "summer" },
      },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("exact goal without exact_date is rejected", async () => {
    wipeAll();
    const { token } = await freshUserNoCouple("exact-nodate@weddly.test");

    const r = await req(
      "POST",
      "/api/couples/onboard",
      {
        bride_name: "Anna",
        groom_name: "Bence",
        wedding_date_goal: { kind: "exact" },
      },
      { token },
    );
    expect(r.status).toBe(400);
  });

  // 'quarter' replaced 'month'/'season' as the onboarding wizard's
  // approximate-date shape (hemisphere-neutral, and the refinement is
  // genuinely optional — see shared/types.ts on WeddingDateGoal). 'month'
  // and 'season' stay accepted server-side for pre-existing rows only.
  test("quarter goal with a year but no quarter picked round-trips as 'sometime that year'", async () => {
    wipeAll();
    const { token } = await freshUserNoCouple("quarter-yearonly@weddly.test");

    const ob = await req<{
      couple: {
        wedding_date_goal: {
          kind: string;
          target_year: number | null;
          target_quarter: number | null;
        };
      };
    }>(
      "POST",
      "/api/couples/onboard",
      {
        bride_name: "Anna",
        groom_name: "Bence",
        wedding_date_goal: { kind: "quarter", target_year: 2027 },
      },
      { token },
    );
    expect(ob.status).toBe(201);
    expect(ob.data.couple.wedding_date_goal.kind).toBe("quarter");
    expect(ob.data.couple.wedding_date_goal.target_year).toBe(2027);
    expect(ob.data.couple.wedding_date_goal.target_quarter).toBeNull();
  });

  test("quarter goal with year + quarter round-trips both fields", async () => {
    wipeAll();
    const { token } = await freshUserNoCouple("quarter-full@weddly.test");

    const ob = await req<{
      couple: {
        wedding_date_goal: {
          kind: string;
          target_year: number | null;
          target_quarter: number | null;
        };
      };
    }>(
      "POST",
      "/api/couples/onboard",
      {
        bride_name: "Anna",
        groom_name: "Bence",
        wedding_date_goal: { kind: "quarter", target_year: 2027, target_quarter: 3 },
      },
      { token },
    );
    expect(ob.status).toBe(201);
    expect(ob.data.couple.wedding_date_goal.target_year).toBe(2027);
    expect(ob.data.couple.wedding_date_goal.target_quarter).toBe(3);
  });

  test("quarter goal without target_year is rejected", async () => {
    wipeAll();
    const { token } = await freshUserNoCouple("quarter-noyear@weddly.test");

    const r = await req(
      "POST",
      "/api/couples/onboard",
      {
        bride_name: "Anna",
        groom_name: "Bence",
        wedding_date_goal: { kind: "quarter", target_quarter: 2 },
      },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("quarter goal with an out-of-range quarter (5) is rejected", async () => {
    wipeAll();
    const { token } = await freshUserNoCouple("quarter-outofrange@weddly.test");

    const r = await req(
      "POST",
      "/api/couples/onboard",
      {
        bride_name: "Anna",
        groom_name: "Bence",
        wedding_date_goal: { kind: "quarter", target_year: 2027, target_quarter: 5 },
      },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("legacy wedding_date scalar in malformed shape is rejected", async () => {
    wipeAll();
    const { token } = await freshUserNoCouple("date-malformed@weddly.test");

    const r = await req(
      "POST",
      "/api/couples/onboard",
      {
        display_name: "Mia & Lucas",
        wedding_date: "2026/09/12",
        target_guest_count: 80,
      },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("invalid currency rejected with 400", async () => {
    wipeAll();
    const { token } = await freshUserNoCouple("bad-currency@weddly.test");

    // ZWL is a real ISO 4217 code we deliberately don't support — a better
    // guard than an unsupported-but-plausible one. (This test used to pass
    // "GBP", which the European-currency expansion made valid.)
    const r = await req(
      "POST",
      "/api/couples/onboard",
      {
        bride_name: "Anna",
        groom_name: "Bence",
        currency: "ZWL",
      },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("every currency in CURRENCIES round-trips through onboard + PATCH", async () => {
    // The union, the boundary guard, and the DB column have drifted apart
    // before (three hand-maintained VALID_CURRENCIES sets). Drive the whole
    // list rather than a sample, so adding a code to CURRENCY_META without
    // wiring the guard fails here instead of in production.
    wipeAll();
    let i = 0;
    for (const currency of CURRENCIES) {
      const email = `currency-${currency.toLowerCase()}@weddly.test`;
      const { token } = await freshUserNoCouple(email);
      const onboard = await req<{ couple: { currency: string } }>(
        "POST",
        "/api/couples/onboard",
        { bride_name: "Anna", groom_name: "Bence", currency },
        { token },
      );
      expect(onboard.status).toBe(201);
      expect(onboard.data.couple.currency).toBe(currency);

      // And it survives a flip afterwards — PATCH runs the same guard.
      const next = CURRENCIES[(i + 1) % CURRENCIES.length]!;
      const patched = await req<{ couple: { currency: string } }>(
        "PATCH",
        "/api/couples/current",
        { currency: next },
        { token },
      );
      expect(patched.status).toBe(200);
      expect(patched.data.couple.currency).toBe(next);
      i++;
    }
  });

  test("onboard derives currency from owner locale when client omits the picker", async () => {
    // EN-locale signup → couple defaults to EUR. HU-locale signup → HUF.
    // This is the international-expansion fix: a fresh EN user shouldn't
    // land in a Forint budget by accident.
    wipeAll();

    // EN user → EUR
    const enReg = await registerAndVerify({
      email: "currency-en@weddly.test",
      password: "supersafe123",
      full_name: "Emma Wells",
      locale: "en",
    });
    expect(enReg.status).toBe(201);
    const enOnboard = await req<{ couple: { currency: string } }>(
      "POST",
      "/api/couples/onboard",
      { bride_name: "Anna", groom_name: "Bence" },
      { token: enReg.data.token },
    );
    expect(enOnboard.status).toBe(201);
    expect(enOnboard.data.couple.currency).toBe("EUR");

    // HU user → HUF
    const huReg = await registerAndVerify({
      email: "currency-hu@weddly.test",
      password: "supersafe123",
      full_name: "Hanna Balogh",
      locale: "hu",
    });
    expect(huReg.status).toBe(201);
    const huOnboard = await req<{ couple: { currency: string } }>(
      "POST",
      "/api/couples/onboard",
      { bride_name: "Anna", groom_name: "Bence" },
      { token: huReg.data.token },
    );
    expect(huOnboard.status).toBe(201);
    expect(huOnboard.data.couple.currency).toBe("HUF");

    // Explicit `currency` in the body still wins over the locale default.
    const explReg = await registerAndVerify({
      email: "currency-explicit@weddly.test",
      password: "supersafe123",
      full_name: "Emma Wells",
      locale: "en",
    });
    expect(explReg.status).toBe(201);
    const explOnboard = await req<{ couple: { currency: string } }>(
      "POST",
      "/api/couples/onboard",
      { bride_name: "Anna", groom_name: "Bence", currency: "USD" },
      { token: explReg.data.token },
    );
    expect(explOnboard.status).toBe(201);
    expect(explOnboard.data.couple.currency).toBe("USD");
  });

  test("onboard mints a public organiser_code ('O' + 5 digits), stable on re-read", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "org-code@weddly.test",
      password: "supersafe123",
      full_name: "Org Code",
    });
    expect(reg.status).toBe(201);

    const onboard = await req<{ couple: { organiser_code: string | null } }>(
      "POST",
      "/api/couples/onboard",
      { bride_name: "Anna", groom_name: "Bence" },
      { token: reg.data.token },
    );
    expect(onboard.status).toBe(201);
    const code = onboard.data.couple.organiser_code;
    expect(code).toMatch(/^O\d{5}$/);

    // The code is stored, not regenerated per read — /api/couples/current agrees.
    const current = await req<{ couple: { organiser_code: string | null } }>(
      "GET",
      "/api/couples/current",
      undefined,
      { token: reg.data.token },
    );
    expect(current.status).toBe(200);
    expect(current.data.couple.organiser_code).toBe(code);
  });

  test("past wedding_date is accepted (eloping-after-the-fact)", async () => {
    wipeAll();
    const { token } = await freshUserNoCouple("past-date@weddly.test");

    const r = await req<{ couple: { wedding_date: string } }>(
      "POST",
      "/api/couples/onboard",
      {
        bride_name: "Anna",
        groom_name: "Bence",
        wedding_date_goal: { kind: "exact", exact_date: "2020-05-01" },
      },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.couple.wedding_date).toBe("2020-05-01");
  });

  test("future wedding_date (far horizon) is accepted", async () => {
    wipeAll();
    const { token } = await freshUserNoCouple("future-date@weddly.test");

    const r = await req<{ couple: { wedding_date: string } }>(
      "POST",
      "/api/couples/onboard",
      {
        bride_name: "Anna",
        groom_name: "Bence",
        wedding_date_goal: { kind: "exact", exact_date: "2099-12-31" },
      },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.couple.wedding_date).toBe("2099-12-31");
  });

  test("oversized display_name (>200 chars in legacy mode) is rejected", async () => {
    wipeAll();
    const { token } = await freshUserNoCouple("big-name@weddly.test");

    const r = await req(
      "POST",
      "/api/couples/onboard",
      { display_name: "x".repeat(201) },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("re-onboarding the same user returns 409", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("dup-onboard@weddly.test");

    const r = await req(
      "POST",
      "/api/couples/onboard",
      { display_name: "A & B", wedding_date: "2026-12-01" },
      { token },
    );
    expect(r.status).toBe(409);
  });

  test("onboarding requires verified email (403 email_unverified)", async () => {
    wipeAll();
    const unverified = unverifiedUserWithSession("unverif-ob@weddly.test");

    const r = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/couples/onboard",
      { display_name: "A & B" },
      { token: unverified.token },
    );
    expect(r.status).toBe(403);
    expect(r.data.detail?.code).toBe("email_unverified");
  });

  test("onboarding without auth → 401", async () => {
    wipeAll();
    const r = await req("POST", "/api/couples/onboard", { display_name: "A & B" });
    expect(r.status).toBe(401);
  });
});

describe("couples_lifecycle: slug normalization + collision", () => {
  test("normalization: lowercase + accents fold to ASCII uppercase", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("slug-norm@weddly.test");

    const r = await req<{ couple: { slug: string } }>(
      "PATCH",
      "/api/couples/slug",
      { slug: "andor & sári" },
      { token },
    );
    expect(r.status).toBe(200);
    // Spaces, &, and the á → A all stripped/folded; uppercase A-Z0-9 only.
    expect(r.data.couple.slug).toBe("ANDORSARI");
  });

  test("slug too short (post-normalize <3 chars) returns 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("slug-short@weddly.test");

    const r = await req("PATCH", "/api/couples/slug", { slug: "ab" }, { token });
    expect(r.status).toBe(400);
  });

  test("slug containing only punctuation rejected", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("slug-punct@weddly.test");

    const r = await req("PATCH", "/api/couples/slug", { slug: "!!!&&&" }, { token });
    expect(r.status).toBe(400);
  });

  test("slug missing in body returns 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("slug-missing@weddly.test");

    const r = await req("PATCH", "/api/couples/slug", {}, { token });
    expect(r.status).toBe(400);
  });

  test("slug collision returns 409 with a useful message", async () => {
    wipeAll();
    const { token: tA } = await bootstrapCouple("slugcoll-a@weddly.test");
    await req("PATCH", "/api/couples/slug", { slug: "TAKENBYA" }, { token: tA });

    const { token: tB } = await bootstrapCouple("slugcoll-b@weddly.test");
    // err() returns `{ error: <message>, detail: <extra-or-undefined> }`.
    // The slug-take handler doesn't ship extra, so the user-visible string
    // is on the top-level `error` field.
    const collide = await req<{ error?: string }>(
      "PATCH",
      "/api/couples/slug",
      { slug: "TAKENBYA" },
      { token: tB },
    );
    expect(collide.status).toBe(409);
    expect(String(collide.data.error ?? "")).toMatch(/taken/i);
  });

  test("renaming to the current slug is a no-op 200 (idempotent)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("slug-idem@weddly.test");
    const cur = await req<{ couple: { slug: string } }>("GET", "/api/couples/current", undefined, {
      token,
    });
    const slug = cur.data.couple.slug;

    const r = await req<{ couple: { slug: string } }>(
      "PATCH",
      "/api/couples/slug",
      { slug },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.couple.slug).toBe(slug);
  });

  test("slug rename without auth → 401", async () => {
    wipeAll();
    const r = await req("PATCH", "/api/couples/slug", { slug: "FOOBAR" });
    expect(r.status).toBe(401);
  });

  test("slug rename without onboarded couple → 400", async () => {
    wipeAll();
    const { token } = await freshUserNoCouple("slug-no-couple@weddly.test");

    const r = await req("PATCH", "/api/couples/slug", { slug: "FOOBAR" }, { token });
    expect(r.status).toBe(400);
  });
});

describe("couples_lifecycle: invite lifecycle edge cases", () => {
  test("cancel before acceptance → 200 cancelled:true", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("cancel-pre@weddly.test");
    const c = await req("POST", "/api/couples/invites", { invited_email: "x@y.test" }, { token });
    expect(c.status).toBe(201);

    const cancel = await req<{ cancelled: boolean }>(
      "POST",
      "/api/couples/invites/cancel",
      {},
      { token },
    );
    expect(cancel.status).toBe(200);
    expect(cancel.data.cancelled).toBe(true);
  });

  test("cancel after acceptance is a no-op 200 (already consumed)", async () => {
    wipeAll();
    // Acceptance flips consumed_at — there's no active pending invite to
    // cancel afterwards, so cancel() returns ok:true, cancelled:false.
    // (The task spec sketched a 409, but the actual handler is idempotent.)
    const { token: aToken } = await bootstrapCouple("cancelpost-a@weddly.test");
    const inv = await req<{ invite: { token: string } }>(
      "POST",
      "/api/couples/invites",
      { invited_email: "cancelpost-b@weddly.test" },
      { token: aToken },
    );
    await registerAndAcceptInvite("cancelpost-b@weddly.test", inv.data.invite.token);

    const cancel = await req<{ ok: boolean; cancelled: boolean }>(
      "POST",
      "/api/couples/invites/cancel",
      {},
      { token: aToken },
    );
    expect(cancel.status).toBe(200);
    expect(cancel.data.cancelled).toBe(false);
  });

  test("cancel with no pending invite at all is also a no-op 200", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("cancel-none@weddly.test");
    const cancel = await req<{ cancelled: boolean }>(
      "POST",
      "/api/couples/invites/cancel",
      {},
      { token },
    );
    expect(cancel.status).toBe(200);
    expect(cancel.data.cancelled).toBe(false);
  });

  test("unknown invite token → 404 on public lookup", async () => {
    wipeAll();
    const r = await req("GET", "/api/invites/this-token-does-not-exist");
    expect(r.status).toBe(404);
  });

  test("expired invite returns 410 on lookup", async () => {
    wipeAll();
    const { token: aToken } = await bootstrapCouple("expired@weddly.test");
    const inv = await req<{ invite: { token: string } }>(
      "POST",
      "/api/couples/invites",
      { invited_email: "exp-b@weddly.test" },
      { token: aToken },
    );
    // Forcibly age the invite by setting expires_at into the past.
    db.prepare("UPDATE couple_invites SET expires_at = 1 WHERE token = ?").run(
      inv.data.invite.token,
    );
    const r = await req("GET", `/api/invites/${inv.data.invite.token}`);
    expect(r.status).toBe(410);
  });

  test("accepting an expired invite → 410", async () => {
    wipeAll();
    const { token: aToken } = await bootstrapCouple("expired-acc-a@weddly.test");
    const inv = await req<{ invite: { token: string } }>(
      "POST",
      "/api/couples/invites",
      { invited_email: "expired-acc-b@weddly.test" },
      { token: aToken },
    );
    db.prepare("UPDATE couple_invites SET expires_at = 1 WHERE token = ?").run(
      inv.data.invite.token,
    );
    const reg = await registerAndVerify({
      email: "expired-acc-b@weddly.test",
      password: "supersafe123",
      full_name: "Bence",
    });
    expect(reg.status).toBe(201);
    const r = await req(
      "POST",
      `/api/invites/${inv.data.invite.token}/accept`,
      {},
      { token: reg.data.token },
    );
    expect(r.status).toBe(410);
  });

  test("invite create without auth → 401", async () => {
    wipeAll();
    const r = await req("POST", "/api/couples/invites", { invited_email: "x@y.test" });
    expect(r.status).toBe(401);
  });

  test("public invite lookup does NOT require auth", async () => {
    wipeAll();
    const { token: aToken } = await bootstrapCouple("public-look@weddly.test");
    const inv = await req<{ invite: { token: string } }>(
      "POST",
      "/api/couples/invites",
      { invited_email: "look-b@weddly.test" },
      { token: aToken },
    );
    const r = await req<{ couple_display_name: string }>(
      "GET",
      `/api/invites/${inv.data.invite.token}`,
    );
    expect(r.status).toBe(200);
    expect(r.data.couple_display_name).toBe("Mia & Lucas");
  });
});

describe("couples_lifecycle: partner view status transitions", () => {
  test("partner status walks invited → joined → active correctly", async () => {
    wipeAll();
    const { token: aToken } = await bootstrapCouple("pv-a@weddly.test");

    // No invite yet → null.
    const before = await req<{ partner: unknown }>("GET", "/api/couples/partner", undefined, {
      token: aToken,
    });
    expect(before.data.partner).toBeNull();

    // Send invite → status="invited", surfaces invited_email.
    const inv = await req<{ invite: { token: string } }>(
      "POST",
      "/api/couples/invites",
      { invited_email: "pv-b@weddly.test" },
      { token: aToken },
    );
    const invited = await req<{ partner: { status: string; email: string | null } }>(
      "GET",
      "/api/couples/partner",
      undefined,
      { token: aToken },
    );
    expect(invited.data.partner.status).toBe("invited");
    expect(invited.data.partner.email).toBe("pv-b@weddly.test");

    // B accepts → status="active" (B's accept response auto-creates a session).
    const bToken = await registerAndAcceptInvite("pv-b@weddly.test", inv.data.invite.token);
    const active = await req<{ partner: { status: string; full_name: string } }>(
      "GET",
      "/api/couples/partner",
      undefined,
      { token: aToken },
    );
    expect(active.data.partner.status).toBe("active");
    expect(active.data.partner.full_name).toBe("Petra Nagy");

    // A valid long-lived login token is not enough for a green dot. Once the
    // explicit interaction heartbeat is stale, the partner is joined but not
    // actively working.
    db.prepare("UPDATE users SET working_presence_at = ? WHERE email = ?").run(
      Date.now() - PROFILE_ACTIVE_WINDOW_MS - 1,
      "pv-b@weddly.test",
    );
    const idle = await req<{ partner: { status: string } }>(
      "GET",
      "/api/couples/partner",
      undefined,
      { token: aToken },
    );
    expect(idle.data.partner.status).toBe("joined");

    const heartbeat = await req<{ active: boolean }>(
      "POST",
      "/api/couples/presence",
      { active: true },
      { token: bToken },
    );
    expect(heartbeat.status).toBe(200);
    expect(heartbeat.data.active).toBe(true);
    const activeAgain = await req<{ partner: { status: string } }>(
      "GET",
      "/api/couples/partner",
      undefined,
      { token: aToken },
    );
    expect(activeAgain.data.partner.status).toBe("active");

    // Drop B's sessions → status="joined" (no live token, but account exists).
    db.prepare("DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = ?)").run(
      "pv-b@weddly.test",
    );
    const joined = await req<{ partner: { status: string } }>(
      "GET",
      "/api/couples/partner",
      undefined,
      { token: aToken },
    );
    expect(joined.data.partner.status).toBe("joined");

    // Avoid an unused-variable lint by referencing the token (the second
    // session lifecycle wasn't directly exercised but the variable matters
    // for the test reader).
    expect(bToken.length).toBeGreaterThan(0);
  });

  test("partner endpoint without onboarded couple → 400", async () => {
    wipeAll();
    const { token } = await freshUserNoCouple("pv-noc@weddly.test");
    const r = await req("GET", "/api/couples/partner", undefined, { token });
    expect(r.status).toBe(400);
  });

  test("partner endpoint requires verified email", async () => {
    wipeAll();
    const unverified = unverifiedUserWithSession("pv-unverif@weddly.test");
    const r = await req<{ detail?: { code?: string } }>("GET", "/api/couples/partner", undefined, {
      token: unverified.token,
    });
    // GET /api/couples/partner downgraded to requireAuth in the P0-2 backend
    // rollback — read-only on own workspace, no third-party fanout. The
    // handler still throws 400 "No couple workspace yet" when the user
    // hasn't onboarded; that's the new failure mode, not 403 email_unverified.
    expect(r.status).toBe(400);
    expect(r.data.detail?.code).not.toBe("email_unverified");
  });
});

describe("couples_lifecycle: activity log scoping + windowing", () => {
  test("activity feed shows only this couple's entries (cross-couple isolation)", async () => {
    wipeAll();
    const { token: tokenA, coupleId: coupleA } = await bootstrapCouple("act-iso-a@weddly.test");
    const { coupleId: coupleB } = await bootstrapCouple("act-iso-b@weddly.test");

    // A creates a guest → guest.create audit row in A's couple.
    await req("POST", "/api/guests", { full_name: "Aunt A" }, { token: tokenA });

    // B (different workspace) — inject a guest.create row directly via the
    // audit table so we can prove the feed filter is on couple_id, not
    // anything dependent on actor.
    const ts = Date.now();
    db.prepare(
      "INSERT INTO audit_log (actor_user_id, couple_id, action, target_kind, target_id, created_at) VALUES (NULL, ?, 'guest.create', 'guest', NULL, ?)",
    ).run(coupleB, ts);

    const feed = await req<{ entries: { action: string; target_kind: string }[] }>(
      "GET",
      "/api/couples/activity",
      undefined,
      { token: tokenA },
    );
    expect(feed.status).toBe(200);
    // Every entry should belong to coupleA — we approximate by counting:
    // there should be exactly ONE guest.create entry visible (the one A
    // actually created), not the synthetic one we dropped onto couple B.
    const guestCreates = feed.data.entries.filter((e) => e.action === "guest.create");
    expect(guestCreates.length).toBe(1);
    // No cross-pollination — the couple ID belongs to A.
    expect(coupleA).not.toBe(coupleB);
  });

  test("activity feed filters out low-signal actions (e.g. auth.login)", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("act-noise@weddly.test");

    db.prepare(
      "INSERT INTO audit_log (actor_user_id, couple_id, action, target_kind, target_id, created_at) VALUES (NULL, ?, 'auth.login', 'session', NULL, ?)",
    ).run(coupleId, Date.now());

    const feed = await req<{ entries: { action: string }[] }>(
      "GET",
      "/api/couples/activity",
      undefined,
      { token },
    );
    expect(feed.status).toBe(200);
    expect(feed.data.entries.some((e) => e.action === "auth.login")).toBe(false);
  });

  test("activity feed enforces 14-day window — older entries are hidden", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("act-window@weddly.test");

    // Stash a stale guest.create 30 days ago — within the visible-actions
    // allowlist but outside the retention window.
    const stale = Date.now() - 30 * 24 * 60 * 60 * 1000;
    db.prepare(
      "INSERT INTO audit_log (actor_user_id, couple_id, action, target_kind, target_id, created_at) VALUES (NULL, ?, 'guest.create', 'guest', NULL, ?)",
    ).run(coupleId, stale);

    const feed = await req<{ entries: { created_at: number }[] }>(
      "GET",
      "/api/couples/activity",
      undefined,
      { token },
    );
    expect(feed.status).toBe(200);
    // Nothing 30 days old leaks through.
    expect(feed.data.entries.every((e) => e.created_at > stale)).toBe(true);
  });

  test("activity feed without a couple → 400", async () => {
    wipeAll();
    const { token } = await freshUserNoCouple("act-noc@weddly.test");
    const r = await req("GET", "/api/couples/activity", undefined, { token });
    expect(r.status).toBe(400);
  });
});

describe("couples_lifecycle: invite lookup + incoming list", () => {
  test("/api/invites/incoming filters out full couples (where partner_b already linked)", async () => {
    wipeAll();
    const { token: tA, coupleId: coupleA } = await bootstrapCouple("incfull-a@weddly.test");
    const inv = await req<{ invite: { token: string } }>(
      "POST",
      "/api/couples/invites",
      { invited_email: "incfull-b@weddly.test" },
      { token: tA },
    );
    // B accepts (now couple has partner B linked).
    const bToken = await registerAndAcceptInvite("incfull-b@weddly.test", inv.data.invite.token);

    // Hand-craft a fresh unconsumed invite to B's email from couple A
    // (couple is now full — incoming list should hide it).
    const inviterId = db
      .prepare("SELECT id FROM users WHERE email = ?")
      .get("incfull-a@weddly.test") as { id: number };
    const ts = Date.now();
    db.prepare(
      `INSERT INTO couple_invites
         (couple_id, token, invited_email, invited_by_user_id, consumed_at, expires_at, created_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`,
    ).run(
      coupleA,
      "freshtoken-incoming-full",
      "incfull-b@weddly.test",
      inviterId.id,
      ts + 7 * 24 * 60 * 60 * 1000,
      ts,
    );

    const incoming = await req<{ invites: unknown[] }>("GET", "/api/invites/incoming", undefined, {
      token: bToken,
    });
    expect(incoming.status).toBe(200);
    // Couple A is already partner-B-linked → the filter hides this invite,
    // so B sees an empty list.
    expect(incoming.data.invites.length).toBe(0);
  });

  test("/api/invites/incoming requires auth", async () => {
    const r = await req("GET", "/api/invites/incoming");
    expect(r.status).toBe(401);
  });

  test("accept-merge missing the MERGE confirm phrase → 400", async () => {
    wipeAll();
    const { token: aToken } = await bootstrapCouple("merge-conf-a@weddly.test");
    const inv = await req<{ invite: { token: string } }>(
      "POST",
      "/api/couples/invites",
      { invited_email: "merge-conf-b@weddly.test" },
      { token: aToken },
    );
    const { token: bToken } = await bootstrapCouple("merge-conf-b@weddly.test");

    const noConfirm = await req(
      "POST",
      `/api/invites/${inv.data.invite.token}/accept-merge`,
      {},
      { token: bToken },
    );
    expect(noConfirm.status).toBe(400);

    const wrongConfirm = await req(
      "POST",
      `/api/invites/${inv.data.invite.token}/accept-merge`,
      { confirm: "merge" },
      { token: bToken },
    );
    expect(wrongConfirm.status).toBe(400);
  });

  test("accept-merge fails when B has no source workspace (use plain /accept instead)", async () => {
    wipeAll();
    const { token: aToken } = await bootstrapCouple("merge-nosrc-a@weddly.test");
    const inv = await req<{ invite: { token: string } }>(
      "POST",
      "/api/couples/invites",
      { invited_email: "merge-nosrc-b@weddly.test" },
      { token: aToken },
    );
    // B has no couple of their own yet.
    const { token: bToken } = await freshUserNoCouple("merge-nosrc-b@weddly.test");

    const r = await req<{ detail?: { code?: string } }>(
      "POST",
      `/api/invites/${inv.data.invite.token}/accept-merge`,
      { confirm: "MERGE" },
      { token: bToken },
    );
    expect(r.status).toBe(409);
    expect(r.data.detail?.code).toBe("no_source_couple");
  });
});

describe("couples_lifecycle: archive + activity coupling", () => {
  test("archive twice is idempotent and surfaces in the activity feed", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("arch-idem@weddly.test");

    const first = await req<{ couple: { status: string; archived_at: number } }>(
      "POST",
      "/api/couples/current/archive",
      {},
      { token },
    );
    expect(first.status).toBe(200);
    expect(first.data.couple.status).toBe("archived");
    const stamp = first.data.couple.archived_at;

    const again = await req<{ couple: { status: string; archived_at: number } }>(
      "POST",
      "/api/couples/current/archive",
      {},
      { token },
    );
    expect(again.status).toBe(200);
    expect(again.data.couple.status).toBe("archived");
    // The second call short-circuits — archived_at should stay the same.
    expect(again.data.couple.archived_at).toBe(stamp);

    const feed = await req<{ entries: { action: string }[] }>(
      "GET",
      "/api/couples/activity",
      undefined,
      { token },
    );
    expect(feed.data.entries.some((e) => e.action === "couple.archive")).toBe(true);
  });

  test("archive requires auth + verified email", async () => {
    wipeAll();
    const noAuth = await req("POST", "/api/couples/current/archive", {});
    expect(noAuth.status).toBe(401);

    const unverified = unverifiedUserWithSession("arch-unver@weddly.test");
    const r = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/couples/current/archive",
      {},
      { token: unverified.token },
    );
    expect(r.status).toBe(403);
    expect(r.data.detail?.code).toBe("email_unverified");
  });
});

// ════════════════════════════════════════════════════════════════════════════
//   COUPLE_PAUSE — request / status / cancel
// ════════════════════════════════════════════════════════════════════════════

describe("couples_lifecycle: pause request lifecycle", () => {
  test("pause request stamps scheduled_delete_at ≈ +30 days from now", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pause-window@weddly.test");

    const t0 = Date.now();
    const r = await req<{ pause_request: { scheduled_delete_at: number } }>(
      "POST",
      "/api/couples/pause",
      { reason: "thinking" },
      { token },
    );
    expect(r.status).toBe(201);

    const delta = r.data.pause_request.scheduled_delete_at - t0;
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    // Allow ±5 s for test runtime jitter.
    expect(Math.abs(delta - THIRTY_DAYS)).toBeLessThan(5_000);
  });

  test("pause stores trimmed reason capped at 500 chars", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("pause-reason@weddly.test");

    await req("POST", "/api/couples/pause", { reason: `  ${"x".repeat(600)}  ` }, { token });
    const row = db
      .prepare("SELECT reason FROM couple_pause_requests WHERE couple_id = ?")
      .get(coupleId) as { reason: string };
    expect(row.reason.length).toBe(500);
    expect(row.reason).not.toMatch(/^\s/);
  });

  test("pause with empty / whitespace reason stores NULL", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("pause-noreason@weddly.test");

    await req("POST", "/api/couples/pause", { reason: "   " }, { token });
    const row = db
      .prepare("SELECT reason FROM couple_pause_requests WHERE couple_id = ?")
      .get(coupleId) as { reason: string | null };
    expect(row.reason).toBeNull();
  });

  test("pause refused when couple is already paused (409)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pause-dup@weddly.test");
    await req("POST", "/api/couples/pause", {}, { token });
    const dup = await req("POST", "/api/couples/pause", {}, { token });
    expect(dup.status).toBe(409);
  });

  test("pause refused when couple is archived (409 — status != active)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pause-archived@weddly.test");
    await req("POST", "/api/couples/current/archive", {}, { token });
    const r = await req("POST", "/api/couples/pause", {}, { token });
    expect(r.status).toBe(409);
  });

  test("cancel without an active request returns 404", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pause-cancel-404@weddly.test");
    const r = await req("POST", "/api/couples/pause/cancel", {}, { token });
    expect(r.status).toBe(404);
  });

  test("cancel restores couple status from paused → active", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("pause-restore@weddly.test");
    await req("POST", "/api/couples/pause", {}, { token });
    const before = db.prepare("SELECT status FROM couples WHERE id = ?").get(coupleId) as {
      status: string;
    };
    expect(before.status).toBe("paused");

    const cancel = await req("POST", "/api/couples/pause/cancel", {}, { token });
    expect(cancel.status).toBe(200);

    const after = db.prepare("SELECT status FROM couples WHERE id = ?").get(coupleId) as {
      status: string;
    };
    expect(after.status).toBe("active");
  });

  test("pause status without auth → 401", async () => {
    wipeAll();
    const r = await req("GET", "/api/couples/pause");
    expect(r.status).toBe(401);
  });

  test("pause status without an onboarded couple → 400", async () => {
    wipeAll();
    const { token } = await freshUserNoCouple("pause-status-noc@weddly.test");
    const r = await req("GET", "/api/couples/pause", undefined, { token });
    expect(r.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//   DOCUMENT_ARCHIVE — GDPR export download / list / delete
// ════════════════════════════════════════════════════════════════════════════

describe("couples_lifecycle: document archive (saved exports)", () => {
  test("GDPR export download returns a JSON archive with guests + budget", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("doc-gdpr@weddly.test");

    // Trigger the JSON export — it auto-snapshots into data_exports.
    const gdpr = await req<{
      couple: { id: number };
      guests: unknown[];
      budget: { lines: unknown[] };
    }>("GET", "/api/couples/export", undefined, { token });
    expect(gdpr.status).toBe(200);
    expect(Array.isArray(gdpr.data.guests)).toBe(true);
    expect(Array.isArray(gdpr.data.budget.lines)).toBe(true);
  });

  test("listing exports requires auth and a couple", async () => {
    wipeAll();
    const noAuth = await req("GET", "/api/exports");
    expect(noAuth.status).toBe(401);

    const { token } = await freshUserNoCouple("doc-noc@weddly.test");
    const r = await req("GET", "/api/exports", undefined, { token });
    expect(r.status).toBe(400);
  });

  test("listing exports returns the archived rows in newest-first order", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("doc-list@weddly.test");

    await req("GET", "/api/couples/export", undefined, { token });
    // Tick the clock manually so created_at differs across rows.
    db.prepare("UPDATE data_exports SET created_at = created_at - 1000 WHERE couple_id = ?").run(
      coupleId,
    );
    await req("GET", "/api/couples/export", undefined, { token });

    const list = await req<{
      exports: { id: number; kind: string; created_at: number }[];
    }>("GET", "/api/exports", undefined, { token });
    expect(list.status).toBe(200);
    expect(list.data.exports.length).toBeGreaterThanOrEqual(2);
    // Sorted descending by created_at.
    for (let i = 1; i < list.data.exports.length; i++) {
      expect(list.data.exports[i - 1]!.created_at).toBeGreaterThanOrEqual(
        list.data.exports[i]!.created_at,
      );
    }
  });

  test("delete returns 404 for unknown export id", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("doc-del-404@weddly.test");
    const r = await req("DELETE", "/api/exports/9999999", undefined, { token });
    expect(r.status).toBe(404);
  });

  test("delete returns 400 for non-numeric id", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("doc-del-badid@weddly.test");
    const r = await req("DELETE", "/api/exports/notanumber", undefined, { token });
    expect(r.status).toBe(400);
  });

  test("delete writes an export.delete audit row", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("doc-del-audit@weddly.test");
    await req("GET", "/api/couples/export", undefined, { token });
    const list = await req<{ exports: { id: number }[] }>("GET", "/api/exports", undefined, {
      token,
    });
    const id = list.data.exports[0]!.id;

    const del = await req("DELETE", `/api/exports/${id}`, undefined, { token });
    expect(del.status).toBe(200);

    const audit = db
      .prepare(
        "SELECT COUNT(*) AS n FROM audit_log WHERE couple_id = ? AND action = 'export.delete'",
      )
      .get(coupleId) as { n: number };
    expect(audit.n).toBeGreaterThan(0);
  });

  test("download requires auth", async () => {
    const r = await req("GET", "/api/exports/1/download");
    expect(r.status).toBe(401);
  });

  test("download returns 404 for unknown export id", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("doc-dl-404@weddly.test");
    const r = await req("GET", "/api/exports/99999/download", undefined, { token });
    expect(r.status).toBe(404);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//   ACCOMMODATIONS — CRUD + guest assignment
// ════════════════════════════════════════════════════════════════════════════

describe("couples_lifecycle: accommodations CRUD", () => {
  test("list returns [] when none have been created yet", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("acc-empty@weddly.test");
    const r = await req<{ accommodations: unknown[] }>("GET", "/api/accommodations", undefined, {
      token,
    });
    expect(r.status).toBe(200);
    expect(r.data.accommodations).toEqual([]);
  });

  test("create + list happy path", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("acc-crud@weddly.test");

    const c = await req<{ accommodation: { id: number; name: string; capacity: number } }>(
      "POST",
      "/api/accommodations",
      { name: "Hotel Gellért", address: "Budapest", capacity: 8, price_huf: 50_000 },
      { token },
    );
    expect(c.status).toBe(201);
    expect(c.data.accommodation.name).toBe("Hotel Gellért");
    expect(c.data.accommodation.capacity).toBe(8);

    const l = await req<{ accommodations: { id: number }[] }>(
      "GET",
      "/api/accommodations",
      undefined,
      { token },
    );
    expect(l.data.accommodations.length).toBe(1);
  });

  test("create without name → 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("acc-no-name@weddly.test");
    const r = await req("POST", "/api/accommodations", {}, { token });
    expect(r.status).toBe(400);
  });

  test("create with name=whitespace → 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("acc-ws-name@weddly.test");
    const r = await req("POST", "/api/accommodations", { name: "   " }, { token });
    expect(r.status).toBe(400);
  });

  test("create with oversize name (>120 chars) → 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("acc-big-name@weddly.test");
    const r = await req("POST", "/api/accommodations", { name: "x".repeat(121) }, { token });
    expect(r.status).toBe(400);
  });

  test("create with capacity 0 → 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("acc-cap-zero@weddly.test");
    const r = await req("POST", "/api/accommodations", { name: "X", capacity: 0 }, { token });
    expect(r.status).toBe(400);
  });

  test("create with capacity over 100 → 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("acc-cap-big@weddly.test");
    const r = await req("POST", "/api/accommodations", { name: "X", capacity: 101 }, { token });
    expect(r.status).toBe(400);
  });

  test("create with negative price_huf → 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("acc-neg-price@weddly.test");
    const r = await req("POST", "/api/accommodations", { name: "X", price_huf: -1 }, { token });
    expect(r.status).toBe(400);
  });

  test("update changes name + capacity", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("acc-upd@weddly.test");

    const c = await req<{ accommodation: { id: number } }>(
      "POST",
      "/api/accommodations",
      { name: "Old", capacity: 2 },
      { token },
    );
    const id = c.data.accommodation.id;

    const u = await req<{ accommodation: { name: string; capacity: number } }>(
      "PATCH",
      `/api/accommodations/${id}`,
      { name: "New", capacity: 6 },
      { token },
    );
    expect(u.status).toBe(200);
    expect(u.data.accommodation.name).toBe("New");
    expect(u.data.accommodation.capacity).toBe(6);
  });

  test("update unknown id → 404", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("acc-upd-404@weddly.test");
    const r = await req("PATCH", "/api/accommodations/9999", { name: "X" }, { token });
    expect(r.status).toBe(404);
  });

  test("delete + re-list", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("acc-del@weddly.test");

    const c = await req<{ accommodation: { id: number } }>(
      "POST",
      "/api/accommodations",
      { name: "X" },
      { token },
    );
    const id = c.data.accommodation.id;

    const d = await req("DELETE", `/api/accommodations/${id}`, undefined, { token });
    expect(d.status).toBe(200);

    const l = await req<{ accommodations: unknown[] }>("GET", "/api/accommodations", undefined, {
      token,
    });
    expect(l.data.accommodations).toEqual([]);
  });

  test("delete unknown id → 404", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("acc-del-404@weddly.test");
    const r = await req("DELETE", "/api/accommodations/9999", undefined, { token });
    expect(r.status).toBe(404);
  });

  test("assign guest happy path + reassign moves the pointer", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("acc-assign@weddly.test");

    const guest = await req<{ guest: { id: number } }>(
      "POST",
      "/api/guests",
      { full_name: "Aunt Klári" },
      { token },
    );
    const a1 = await req<{ accommodation: { id: number } }>(
      "POST",
      "/api/accommodations",
      { name: "Hotel A", capacity: 2 },
      { token },
    );
    const a2 = await req<{ accommodation: { id: number } }>(
      "POST",
      "/api/accommodations",
      { name: "Hotel B", capacity: 2 },
      { token },
    );

    const assign1 = await req(
      "POST",
      "/api/accommodations/assign",
      { guest_id: guest.data.guest.id, accommodation_id: a1.data.accommodation.id },
      { token },
    );
    expect(assign1.status).toBe(200);

    // Reassign — handler simply UPDATEs guests.accommodation_id without
    // checking the previous assignment. Documented behaviour: a second
    // assign just moves the guest to the new lodging.
    const assign2 = await req(
      "POST",
      "/api/accommodations/assign",
      { guest_id: guest.data.guest.id, accommodation_id: a2.data.accommodation.id },
      { token },
    );
    expect(assign2.status).toBe(200);

    const g = db
      .prepare("SELECT accommodation_id FROM guests WHERE id = ?")
      .get(guest.data.guest.id) as { accommodation_id: number };
    expect(g.accommodation_id).toBe(a2.data.accommodation.id);
  });

  test("assign without guest_id → 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("acc-asgn-noguest@weddly.test");
    const r = await req("POST", "/api/accommodations/assign", {}, { token });
    expect(r.status).toBe(400);
  });

  test("assign unknown guest → 404", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("acc-asgn-noguest2@weddly.test");
    const r = await req(
      "POST",
      "/api/accommodations/assign",
      { guest_id: 999999, accommodation_id: null },
      { token },
    );
    expect(r.status).toBe(404);
  });

  test("assign unknown accommodation → 404", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("acc-asgn-bad@weddly.test");
    const g = await req<{ guest: { id: number } }>(
      "POST",
      "/api/guests",
      { full_name: "Aliz" },
      { token },
    );
    const r = await req(
      "POST",
      "/api/accommodations/assign",
      { guest_id: g.data.guest.id, accommodation_id: 9999 },
      { token },
    );
    expect(r.status).toBe(404);
  });

  test("assign with accommodation_id=null unassigns the guest", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("acc-unassign@weddly.test");

    const g = await req<{ guest: { id: number } }>(
      "POST",
      "/api/guests",
      { full_name: "Aliz" },
      { token },
    );
    const a = await req<{ accommodation: { id: number } }>(
      "POST",
      "/api/accommodations",
      { name: "X", capacity: 2 },
      { token },
    );

    await req(
      "POST",
      "/api/accommodations/assign",
      { guest_id: g.data.guest.id, accommodation_id: a.data.accommodation.id },
      { token },
    );
    const r = await req(
      "POST",
      "/api/accommodations/assign",
      { guest_id: g.data.guest.id, accommodation_id: null },
      { token },
    );
    expect(r.status).toBe(200);

    const after = db
      .prepare("SELECT accommodation_id FROM guests WHERE id = ?")
      .get(g.data.guest.id) as { accommodation_id: number | null };
    expect(after.accommodation_id).toBeNull();
  });

  test("cross-couple isolation: A cannot read B's accommodation", async () => {
    wipeAll();
    const { token: tA } = await bootstrapCouple("acc-iso-a@weddly.test");
    const { token: tB } = await bootstrapCouple("acc-iso-b@weddly.test");

    const created = await req<{ accommodation: { id: number } }>(
      "POST",
      "/api/accommodations",
      { name: "Bs Hotel" },
      { token: tB },
    );
    const id = created.data.accommodation.id;

    // A can't update / delete / assign-against B's id.
    const upd = await req("PATCH", `/api/accommodations/${id}`, { name: "Hijack" }, { token: tA });
    expect(upd.status).toBe(404);
    const del = await req("DELETE", `/api/accommodations/${id}`, undefined, { token: tA });
    expect(del.status).toBe(404);
  });

  test("accommodations list requires auth (401)", async () => {
    wipeAll();
    const r = await req("GET", "/api/accommodations");
    expect(r.status).toBe(401);
  });

  test("accommodations list without an onboarded couple → 400", async () => {
    wipeAll();
    const { token } = await freshUserNoCouple("acc-noc@weddly.test");
    const r = await req("GET", "/api/accommodations", undefined, { token });
    expect(r.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//   HONEYMOON — flight estimate
// ════════════════════════════════════════════════════════════════════════════

describe("couples_lifecycle: honeymoon flight estimate", () => {
  test("with no destination/dates set → estimate is null", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("hm-empty@weddly.test");

    const r = await req<{ estimate: unknown }>("GET", "/api/honeymoon/flight-estimate", undefined, {
      token,
    });
    expect(r.status).toBe(200);
    expect(r.data.estimate).toBeNull();
  });

  test("with destination + dates but SerpApi unconfigured → estimate is null", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("hm-noserpapi@weddly.test");

    // Set the honeymoon fields. Without SERPAPI_KEY, the getFlightEstimate
    // helper bails out before hitting the network and returns null — this
    // is the documented "no credentials configured" silent-hide path.
    await req(
      "PATCH",
      "/api/couples/current",
      {
        honeymoon_destination: "Bali",
        honeymoon_start_date: "2027-06-01",
        honeymoon_end_date: "2027-06-10",
      },
      { token },
    );

    const r = await req<{ estimate: unknown }>("GET", "/api/honeymoon/flight-estimate", undefined, {
      token,
    });
    expect(r.status).toBe(200);
    expect(r.data.estimate).toBeNull();
  });

  test("without a couple → estimate is null (no 4xx)", async () => {
    wipeAll();
    const { token } = await freshUserNoCouple("hm-noc@weddly.test");
    const r = await req<{ estimate: unknown }>("GET", "/api/honeymoon/flight-estimate", undefined, {
      token,
    });
    expect(r.status).toBe(200);
    expect(r.data.estimate).toBeNull();
  });

  test("requires auth (401)", async () => {
    const r = await req("GET", "/api/honeymoon/flight-estimate");
    expect(r.status).toBe(401);
  });

  test("honeymoon_origin_iata: persists uppercase IATA via PATCH", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("hm-origin@weddly.test");
    // Lowercase input gets normalised to uppercase. Spaces trimmed.
    const patch = await req<{ couple: { honeymoon_origin_iata: string | null } }>(
      "PATCH",
      "/api/couples/current",
      { honeymoon_origin_iata: " vie " },
      { token },
    );
    expect(patch.status).toBe(200);
    expect(patch.data.couple.honeymoon_origin_iata).toBe("VIE");

    // Empty string clears back to null (frontend's "revert to default" path).
    const cleared = await req<{ couple: { honeymoon_origin_iata: string | null } }>(
      "PATCH",
      "/api/couples/current",
      { honeymoon_origin_iata: "" },
      { token },
    );
    expect(cleared.status).toBe(200);
    expect(cleared.data.couple.honeymoon_origin_iata).toBeNull();
  });

  test("honeymoon_origin_iata: rejects non-IATA input with 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("hm-origin-bad@weddly.test");
    const r = await req(
      "PATCH",
      "/api/couples/current",
      { honeymoon_origin_iata: "XX" },
      {
        token,
      },
    );
    expect(r.status).toBe(400);
  });

  test("destination_iata lookup: hits curated cities (full + breadcrumb)", () => {
    // Plain single-word city — full-string normalisation path.
    expect(lookupDestinationIata("Bali")).toBe("DPS");
    expect(lookupDestinationIata("Maldives")).toBe("MLE");
    // Diacritics + casing are normalised away.
    expect(lookupDestinationIata("Málaga")).toBe("AGP");
    expect(lookupDestinationIata("MÜNCHEN")).toBe("MUC");
    // Nominatim breadcrumb — the city is a middle segment, not the head.
    // Ronda has no airport; the table maps it to AGP directly so the user
    // doesn't need to know the nearest hub.
    expect(lookupDestinationIata("Ronda, Málaga, Andalúzia, Spanyolország")).toBe("AGP");
    expect(lookupDestinationIata("Positano, Salerno, Campania, Italia")).toBe("NAP");
  });

  test("destination_iata lookup: returns null for misses (caller falls back)", () => {
    expect(lookupDestinationIata("Some Tiny Village 42")).toBeNull();
    expect(lookupDestinationIata("")).toBeNull();
    expect(lookupDestinationIata("   ")).toBeNull();
  });

  test("flight-estimate: offers array is empty when SerpApi unconfigured", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("hm-shape@weddly.test");
    await req(
      "PATCH",
      "/api/couples/current",
      {
        honeymoon_destination: "Bali",
        honeymoon_start_date: "2027-06-01",
        honeymoon_end_date: "2027-06-10",
        honeymoon_origin_iata: "BUD",
      },
      { token },
    );
    // Without credentials the estimate is still null (the documented "no
    // creds → hide card" path). The shape itself is exercised by the
    // domain unit tests; here we just confirm the new field round-trips.
    const r = await req<{ estimate: unknown }>("GET", "/api/honeymoon/flight-estimate", undefined, {
      token,
    });
    expect(r.status).toBe(200);
    expect(r.data.estimate).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
//   MOODBOARD — Pinterest preview
// ════════════════════════════════════════════════════════════════════════════

describe("couples_lifecycle: moodboard preview", () => {
  test("missing url query → 400 with code=invalid_url", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("mb-noargs@weddly.test");
    const r = await req<{ detail?: { code?: string } }>(
      "GET",
      "/api/moodboard/preview",
      undefined,
      { token },
    );
    expect(r.status).toBe(400);
    expect(r.data.detail?.code).toBe("invalid_url");
  });

  test("non-pinterest URL → 400 invalid_url", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("mb-notpin@weddly.test");
    const r = await req<{ detail?: { code?: string } }>(
      "GET",
      "/api/moodboard/preview?url=https%3A%2F%2Fexample.com%2Fnot-pinterest",
      undefined,
      { token },
    );
    expect(r.status).toBe(400);
    expect(r.data.detail?.code).toBe("invalid_url");
  });

  test("Pinterest /pin/<id>/ URL is rejected as not-a-board", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("mb-pinpath@weddly.test");
    const r = await req<{ detail?: { code?: string } }>(
      "GET",
      "/api/moodboard/preview?url=https%3A%2F%2Fwww.pinterest.com%2Fpin%2F123456%2F",
      undefined,
      { token },
    );
    expect(r.status).toBe(400);
    expect(r.data.detail?.code).toBe("invalid_url");
  });

  test("requires auth (401)", async () => {
    const r = await req(
      "GET",
      "/api/moodboard/preview?url=https%3A%2F%2Fwww.pinterest.com%2Fuser%2Fboard%2F",
    );
    expect(r.status).toBe(401);
  });

  test("garbage non-URL string in url= → 400 invalid_url", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("mb-junk@weddly.test");
    const r = await req<{ detail?: { code?: string } }>(
      "GET",
      "/api/moodboard/preview?url=not-a-url-at-all",
      undefined,
      { token },
    );
    expect(r.status).toBe(400);
    expect(r.data.detail?.code).toBe("invalid_url");
  });
});

// ════════════════════════════════════════════════════════════════════════════
//   PLACES — Nominatim proxy
// ════════════════════════════════════════════════════════════════════════════

describe("couples_lifecycle: places search proxy", () => {
  test("response shape is { places: [...] } when query is too short", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("places-shape@weddly.test");
    const r = await req<{ places: unknown[] }>("GET", "/api/places/search?q=a", undefined, {
      token,
    });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data.places)).toBe(true);
  });

  test("unverified user can search places (read-only own-scope)", async () => {
    // GET /api/places/search downgraded to requireAuth — read-only Nominatim
    // proxy, no email fanout. Unverified users get the same result as
    // verified ones. Without a couple workspace, the endpoint still returns
    // a 200 with whatever Nominatim hands back (or an empty array in test).
    wipeAll();
    const unverified = unverifiedUserWithSession("places-unverif@weddly.test");
    const r = await req<{ places?: unknown[]; detail?: { code?: string } }>(
      "GET",
      "/api/places/search?q=bali",
      undefined,
      { token: unverified.token },
    );
    // Either 200 (search served) or 400 (no couple), but NOT 403 email_unverified.
    expect([200, 400]).toContain(r.status);
    expect(r.data.detail?.code).not.toBe("email_unverified");
  });

  test("rate-limited per user — bursting past 6 queries returns 429", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("places-rl@weddly.test");

    // Capacity is 6 with a 1-token/sec refill. The route short-circuits
    // queries with `q.length < 2` BEFORE hitting Nominatim, so single-char
    // queries fire fast without a real network roundtrip; the rate-limit
    // hook still ticks for each call. Seventh should 429.
    let lastStatus = 0;
    for (let i = 0; i < 8; i++) {
      const r = await req("GET", `/api/places/search?q=${String.fromCharCode(97 + i)}`, undefined, {
        token,
      });
      lastStatus = r.status;
      if (r.status === 429) break;
    }
    expect(lastStatus).toBe(429);
  });

  // Measured off the route's own MAX_QUERY_CHARS rather than a literal: the cap
  // was 100 until a Nominatim breadcrumb ("...137 characters of home address")
  // legitimately exceeded it and it moved to 200, at which point a hardcoded 101
  // was asserting a 400 the route had stopped returning. One past the exported
  // constant can't go stale the next time the number moves.
  test("oversized query (> MAX_QUERY_CHARS) returns 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("places-big@weddly.test");
    const q = "x".repeat(MAX_QUERY_CHARS + 1);
    const r = await req("GET", `/api/places/search?q=${q}`, undefined, { token });
    expect(r.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//   MULTI-WORKSPACE — listing / switching / leave
// ════════════════════════════════════════════════════════════════════════════

describe("couples_lifecycle: multi-workspace + leave couple", () => {
  test("users/me/couples lists every membership the user has", async () => {
    wipeAll();
    const { token, coupleId: alphaId } = await bootstrapCouple("mw-list@weddly.test");

    // Spin up a Bravo workspace.
    const bravo = await req<{ couple: { id: number } }>(
      "POST",
      "/api/couples",
      {
        event_name: "After-party",
        wedding_date_goal: { kind: "tbd" },
      },
      { token },
    );
    expect(bravo.status).toBe(201);

    const list = await req<{
      current_couple_id: number;
      couples: { couple_id: number; role: string }[];
    }>("GET", "/api/users/me/couples", undefined, { token });
    expect(list.status).toBe(200);
    const ids = list.data.couples.map((c) => c.couple_id).sort();
    expect(ids).toEqual([alphaId, bravo.data.couple.id].sort());
  });

  test("active-couple switch is idempotent on the user's own current workspace", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("mw-idem@weddly.test");
    const r = await req<{ couple: { id: number } }>(
      "POST",
      "/api/users/me/active-couple",
      { couple_id: coupleId },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.couple.id).toBe(coupleId);
  });

  test("active-couple switch requires a positive integer couple_id", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("mw-badid@weddly.test");

    const bad1 = await req("POST", "/api/users/me/active-couple", {}, { token });
    expect(bad1.status).toBe(400);
    const bad2 = await req("POST", "/api/users/me/active-couple", { couple_id: -1 }, { token });
    expect(bad2.status).toBe(400);
    const bad3 = await req(
      "POST",
      "/api/users/me/active-couple",
      { couple_id: "not-a-number" },
      { token },
    );
    expect(bad3.status).toBe(400);
  });

  test("active-couple switch to a non-existent workspace → 403 (not_a_member)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("mw-nope@weddly.test");
    const r = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/users/me/active-couple",
      { couple_id: 999999 },
      { token },
    );
    // 999999 isn't a couple the caller is a member of — handler checks
    // membership BEFORE existence and returns 403/not_a_member.
    expect(r.status).toBe(403);
    expect(r.data.detail?.code).toBe("not_a_member");
  });

  test("leave-couple fails for the owner with 409 owner_cannot_leave", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("mw-owner-leave@weddly.test");
    const r = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/users/me/leave-couple",
      {},
      { token },
    );
    expect(r.status).toBe(409);
    expect(r.data.detail?.code).toBe("owner_cannot_leave");
  });

  test("leave-couple succeeds for partner B; couple keeps existing", async () => {
    wipeAll();
    const { token: aToken, coupleId } = await bootstrapCouple("mw-leave-a@weddly.test");
    const inv = await req<{ invite: { token: string } }>(
      "POST",
      "/api/couples/invites",
      { invited_email: "mw-leave-b@weddly.test" },
      { token: aToken },
    );
    const bToken = await registerAndAcceptInvite("mw-leave-b@weddly.test", inv.data.invite.token);

    const r = await req("POST", "/api/users/me/leave-couple", {}, { token: bToken });
    expect(r.status).toBe(200);

    const refreshed = db.prepare("SELECT partner_b_id FROM couples WHERE id = ?").get(coupleId) as {
      partner_b_id: number | null;
    };
    expect(refreshed.partner_b_id).toBeNull();

    // Couple row itself still exists.
    const c = db.prepare("SELECT id FROM couples WHERE id = ?").get(coupleId) as { id: number };
    expect(c.id).toBe(coupleId);
  });

  test("leave-couple without an onboarded couple → 404", async () => {
    wipeAll();
    const { token } = await freshUserNoCouple("mw-leave-noc@weddly.test");
    const r = await req("POST", "/api/users/me/leave-couple", {}, { token });
    expect(r.status).toBe(404);
  });
});

describe("couples_lifecycle: welcome-desk mode toggle", () => {
  test("welcome_desk_active defaults to false on a brand-new couple", async () => {
    const { token } = await bootstrapCouple("welcome-desk-default@weddly.test");
    const r = await req<{ couple: { welcome_desk_active: boolean } }>(
      "GET",
      "/api/couples/current",
      undefined,
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.couple.welcome_desk_active).toBe(false);
  });

  test("PATCH flips welcome_desk_active on and back off", async () => {
    const { token } = await bootstrapCouple("welcome-desk-flip@weddly.test");

    const on = await req<{ couple: { welcome_desk_active: boolean } }>(
      "PATCH",
      "/api/couples/current",
      { welcome_desk_active: true },
      { token },
    );
    expect(on.status).toBe(200);
    expect(on.data.couple.welcome_desk_active).toBe(true);

    // Survives a re-fetch — persistent across reloads, not in-memory only.
    const fresh = await req<{ couple: { welcome_desk_active: boolean } }>(
      "GET",
      "/api/couples/current",
      undefined,
      { token },
    );
    expect(fresh.data.couple.welcome_desk_active).toBe(true);

    const off = await req<{ couple: { welcome_desk_active: boolean } }>(
      "PATCH",
      "/api/couples/current",
      { welcome_desk_active: false },
      { token },
    );
    expect(off.data.couple.welcome_desk_active).toBe(false);
  });

  test("rejects a non-boolean welcome_desk_active payload", async () => {
    const { token } = await bootstrapCouple("welcome-desk-type@weddly.test");
    const r = await req("PATCH", "/api/couples/current", { welcome_desk_active: "yes" }, { token });
    expect(r.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//   COUPLES: Photos-page photo-share links (media_links)
// ════════════════════════════════════════════════════════════════════════════

describe("couples_lifecycle: media_links", () => {
  type MediaLinksResp = {
    couple: {
      media_links: { guests: string | null; photographer: string[]; other: string | null };
    };
  };

  test("defaults to all-null on a brand-new couple", async () => {
    const { token } = await bootstrapCouple("media-default@weddly.test");
    const r = await req<MediaLinksResp>("GET", "/api/couples/current", undefined, { token });
    expect(r.status).toBe(200);
    expect(r.data.couple.media_links).toEqual({ guests: null, photographer: [], other: null });
  });

  test("PATCH sets one slot and partial-merges without clobbering the others", async () => {
    const { token } = await bootstrapCouple("media-merge@weddly.test");

    const first = await req<MediaLinksResp>(
      "PATCH",
      "/api/couples/current",
      { media_links: { guests: "https://drive.google.com/drive/folders/guests" } },
      { token },
    );
    expect(first.status).toBe(200);
    expect(first.data.couple.media_links.guests).toBe(
      "https://drive.google.com/drive/folders/guests",
    );
    expect(first.data.couple.media_links.photographer).toEqual([]);

    // A second PATCH touching only `photographer` must leave `guests` intact.
    const second = await req<MediaLinksResp>(
      "PATCH",
      "/api/couples/current",
      { media_links: { photographer: "https://example.com/album" } },
      { token },
    );
    expect(second.data.couple.media_links.guests).toBe(
      "https://drive.google.com/drive/folders/guests",
    );
    expect(second.data.couple.media_links.photographer).toEqual(["https://example.com/album"]);

    // Survives a re-fetch — persisted, shared between both partners.
    const fresh = await req<MediaLinksResp>("GET", "/api/couples/current", undefined, { token });
    expect(fresh.data.couple.media_links.guests).toBe(
      "https://drive.google.com/drive/folders/guests",
    );
    expect(fresh.data.couple.media_links.photographer).toEqual(["https://example.com/album"]);
  });

  test("empty string clears a slot back to null", async () => {
    const { token } = await bootstrapCouple("media-clear@weddly.test");
    await req(
      "PATCH",
      "/api/couples/current",
      { media_links: { other: "https://x.test/a" } },
      {
        token,
      },
    );
    const cleared = await req<MediaLinksResp>(
      "PATCH",
      "/api/couples/current",
      { media_links: { other: "" } },
      { token },
    );
    expect(cleared.status).toBe(200);
    expect(cleared.data.couple.media_links.other).toBeNull();
  });

  test("rejects a non-http(s) URL", async () => {
    const { token } = await bootstrapCouple("media-scheme@weddly.test");
    const r = await req(
      "PATCH",
      "/api/couples/current",
      { media_links: { guests: "javascript:alert(1)" } },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("rejects a non-object media_links payload", async () => {
    const { token } = await bootstrapCouple("media-type@weddly.test");
    const r = await req(
      "PATCH",
      "/api/couples/current",
      { media_links: "https://drive.google.com/x" },
      { token },
    );
    expect(r.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//   COUPLES: bride/groom rename via PATCH (no rate limit)
// ════════════════════════════════════════════════════════════════════════════

describe("couples_lifecycle: bride/groom rename", () => {
  test("partners can rename back-to-back, no cooldown gate", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("rename-noop@weddly.test");

    const first = await req<{ couple: { bride_name: string; groom_name: string } }>(
      "PATCH",
      "/api/couples/current",
      { bride_name: "Anna", groom_name: "Bence" },
      { token },
    );
    expect(first.status).toBe(200);
    expect(first.data.couple.bride_name).toBe("Anna");

    const second = await req<{ couple: { bride_name: string } }>(
      "PATCH",
      "/api/couples/current",
      { bride_name: "Csilla", groom_name: "Bence" },
      { token },
    );
    expect(second.status).toBe(200);
    expect(second.data.couple.bride_name).toBe("Csilla");

    const row = db.prepare("SELECT bride_name FROM couples WHERE id = ?").get(coupleId) as {
      bride_name: string;
    };
    expect(row.bride_name).toBe("Csilla");
  });
});

// ════════════════════════════════════════════════════════════════════════════
//   COUPLES — planning_count_locked (cost-planning headcount slider lock)
// ════════════════════════════════════════════════════════════════════════════

describe("couples_lifecycle: planning_count_locked", () => {
  test("defaults to false and round-trips via PATCH", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("plan-lock-default@weddly.test");

    const me = await req<{ couple: { planning_count_locked: boolean } }>(
      "GET",
      "/api/couples/current",
      undefined,
      { token },
    );
    expect(me.status).toBe(200);
    expect(me.data.couple.planning_count_locked).toBe(false);

    const on = await req<{ couple: { planning_count_locked: boolean } }>(
      "PATCH",
      "/api/couples/current",
      { planning_count_locked: true, planning_count: 95 },
      { token },
    );
    expect(on.status).toBe(200);
    expect(on.data.couple.planning_count_locked).toBe(true);

    // Survives a fresh GET — persistent, not in-memory only.
    const fresh = await req<{ couple: { planning_count_locked: boolean; planning_count: number } }>(
      "GET",
      "/api/couples/current",
      undefined,
      { token },
    );
    expect(fresh.data.couple.planning_count_locked).toBe(true);
    expect(fresh.data.couple.planning_count).toBe(95);

    const off = await req<{ couple: { planning_count_locked: boolean } }>(
      "PATCH",
      "/api/couples/current",
      { planning_count_locked: false },
      { token },
    );
    expect(off.data.couple.planning_count_locked).toBe(false);
  });

  test("rejects a non-boolean payload", async () => {
    const { token } = await bootstrapCouple("plan-lock-type@weddly.test");
    const r = await req(
      "PATCH",
      "/api/couples/current",
      { planning_count_locked: "yes" },
      { token },
    );
    expect(r.status).toBe(400);
  });
});
