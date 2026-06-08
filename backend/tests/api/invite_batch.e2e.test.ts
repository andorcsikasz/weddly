import "../setup";

import { describe, expect, test } from "bun:test";
import { db } from "../../src/db";
import { bootstrapCouple, req, wipeAll } from "../helpers";

// ────────────────────────────────────────────────────────────────────────────
//   Mass invite send — POST /api/households/invite-batch. The feature's promise
//   is "nobody gets invited twice, nobody gets silently skipped". These tests
//   pin exactly that:
//     * a household with a contact email is invited once and stamped invited_at
//     * a second batch run is a no-op for it (skipped_already_invited) — never 2x
//     * a household with no member email is reported (skipped_no_email), not
//       silently dropped — never 0x without the couple knowing
//     * resend:true is the explicit opt-in to re-send to an already-invited one
//
//   In the test env RESEND_API_KEY is "" so sendKind returns "skipped_no_provider"
//   rather than "sent". The endpoint treats anything that isn't an outright
//   "failed" as dispatched, so the invited_at stamping + dedup still exercise.
// ────────────────────────────────────────────────────────────────────────────

interface GuestResp {
  guest: { id: number; household_id: number | null };
}

interface BatchResp {
  sent: number;
  failed: number;
  skipped_already_invited: number;
  skipped_no_email: number;
  results: Array<{ household_id: number; status: string; email: string | null }>;
}

/** Bootstrap a couple, force a slug (the endpoint refuses without one), and
 *  return the token + couple id. */
async function coupleWithSlug(email: string): Promise<{ token: string; coupleId: number }> {
  const { token, coupleId } = await bootstrapCouple(email);
  db.prepare("UPDATE couples SET slug = ? WHERE id = ?").run("MIALUCAS", coupleId);
  return { token, coupleId };
}

/** Create a guest in a brand-new household; returns the household id. */
async function addGuestHousehold(
  token: string,
  fullName: string,
  email: string | null,
  label: string,
): Promise<number> {
  const r = await req<GuestResp>(
    "POST",
    "/api/guests",
    { full_name: fullName, email, household_id: null, new_household_label: label },
    { token },
  );
  expect(r.status).toBe(201);
  expect(r.data.guest.household_id).not.toBeNull();
  return r.data.guest.household_id as number;
}

describe("invite-batch: dedup + no-email reporting", () => {
  test("1. happy path: one household with email → sent once, invited_at stamped", async () => {
    wipeAll();
    const { token, coupleId } = await coupleWithSlug("ib-happy@weddly.test");
    const hhId = await addGuestHousehold(token, "Bátorfi Edit", "edit@weddly.test", "Szellő 7");

    const r = await req<BatchResp>("POST", "/api/households/invite-batch", {}, { token });
    expect(r.status).toBe(200);
    expect(r.data.sent).toBe(1);
    expect(r.data.failed).toBe(0);
    expect(r.data.skipped_no_email).toBe(0);
    expect(r.data.results.find((x) => x.household_id === hhId)?.status).toBe("sent");

    const hh = db.prepare("SELECT invited_at FROM households WHERE id = ?").get(hhId) as {
      invited_at: number | null;
    };
    expect(hh.invited_at).not.toBeNull();

    // A guest_invite row landed in the email log for this couple.
    const logged = db
      .prepare("SELECT COUNT(*) AS n FROM email_log WHERE couple_id = ? AND kind = 'guest_invite'")
      .get(coupleId) as { n: number };
    expect(logged.n).toBe(1);
  });

  test("2. second run is a no-op for an already-invited household (never 2x)", async () => {
    wipeAll();
    const { token } = await coupleWithSlug("ib-dedup@weddly.test");
    await addGuestHousehold(token, "Guest One", "one@weddly.test", "House One");

    const first = await req<BatchResp>("POST", "/api/households/invite-batch", {}, { token });
    expect(first.data.sent).toBe(1);

    const second = await req<BatchResp>("POST", "/api/households/invite-batch", {}, { token });
    expect(second.status).toBe(200);
    expect(second.data.sent).toBe(0);
    expect(second.data.skipped_already_invited).toBe(1);
  });

  test("3. household with no member email is reported, not silently dropped (never 0x)", async () => {
    wipeAll();
    const { token } = await coupleWithSlug("ib-noemail@weddly.test");
    const noMail = await addGuestHousehold(token, "No Address", null, "Postal Only");

    const r = await req<BatchResp>("POST", "/api/households/invite-batch", {}, { token });
    expect(r.status).toBe(200);
    expect(r.data.sent).toBe(0);
    expect(r.data.skipped_no_email).toBe(1);
    expect(r.data.results.find((x) => x.household_id === noMail)?.status).toBe("skipped_no_email");

    const hh = db.prepare("SELECT invited_at FROM households WHERE id = ?").get(noMail) as {
      invited_at: number | null;
    };
    expect(hh.invited_at).toBeNull();
  });

  test("4. resend:true re-sends to an already-invited household", async () => {
    wipeAll();
    const { token } = await coupleWithSlug("ib-resend@weddly.test");
    await addGuestHousehold(token, "Repeat Guest", "repeat@weddly.test", "Repeat House");

    const first = await req<BatchResp>("POST", "/api/households/invite-batch", {}, { token });
    expect(first.data.sent).toBe(1);

    const resend = await req<BatchResp>(
      "POST",
      "/api/households/invite-batch",
      { resend: true },
      { token },
    );
    expect(resend.status).toBe(200);
    expect(resend.data.sent).toBe(1);
    expect(resend.data.skipped_already_invited).toBe(0);
  });

  test("5. explicit household_ids scopes the send to just those households", async () => {
    wipeAll();
    const { token } = await coupleWithSlug("ib-scope@weddly.test");
    const a = await addGuestHousehold(token, "Alpha", "alpha@weddly.test", "Alpha House");
    const b = await addGuestHousehold(token, "Bravo", "bravo@weddly.test", "Bravo House");

    const r = await req<BatchResp>(
      "POST",
      "/api/households/invite-batch",
      { household_ids: [a] },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.sent).toBe(1);
    expect(r.data.results.find((x) => x.household_id === a)?.status).toBe("sent");

    // B was not in scope → still uninvited.
    const bRow = db.prepare("SELECT invited_at FROM households WHERE id = ?").get(b) as {
      invited_at: number | null;
    };
    expect(bRow.invited_at).toBeNull();
  });

  test("6. no slug → 400 before any send", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("ib-noslug@weddly.test");
    db.prepare("UPDATE couples SET slug = NULL WHERE id = ?").run(coupleId);
    await req<GuestResp>(
      "POST",
      "/api/guests",
      {
        full_name: "Someone",
        email: "someone@weddly.test",
        household_id: null,
        new_household_label: "X",
      },
      { token },
    );

    const r = await req("POST", "/api/households/invite-batch", {}, { token });
    expect(r.status).toBe(400);
  });
});
