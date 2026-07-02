// Newsletter capture double opt-in: subscribe → pending + confirm token,
// confirm → confirmed, unsubscribe → suppression record. The subscribe
// endpoint always answers a bare 200 so it can't be used to probe who is on
// the list.

import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import { PRIVACY_VERSION } from "@shared/legal";
import { __testPlaintextForHash } from "../../src/auth/tokens";
import { db } from "../../src/db";
import { req } from "../helpers";

interface SubscriberRow {
  id: number;
  email: string;
  locale: string;
  status: string;
  token_hash: string | null;
  token_created_at: number | null;
  source: string | null;
}

function subscriber(email: string): SubscriberRow | null {
  return (
    (db
      .prepare("SELECT * FROM newsletter_subscribers WHERE email = ?")
      .get(email) as SubscriberRow | null) ?? null
  );
}

/** Resolve the plaintext confirm/unsubscribe token for an address via the
 *  test-only hash→plaintext capture (tokens are hashed at rest). */
function tokenFor(email: string): string {
  const row = subscriber(email);
  if (!row?.token_hash) throw new Error(`no token for ${email}`);
  const plain = __testPlaintextForHash(row.token_hash);
  if (!plain) throw new Error(`plaintext not captured for ${email}`);
  return plain;
}

function subscribeBody(email: string, extra?: Record<string, unknown>) {
  return { email, locale: "hu", source: "landing", privacy_version: PRIVACY_VERSION, ...extra };
}

beforeEach(() => {
  db.prepare("DELETE FROM newsletter_subscribers").run();
});

describe("newsletter double opt-in", () => {
  test("subscribe creates a pending row and records consent", async () => {
    const res = await req("POST", "/api/newsletter/subscribe", subscribeBody("nl1@example.com"));
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ ok: true });

    const row = subscriber("nl1@example.com");
    expect(row?.status).toBe("pending");
    expect(row?.locale).toBe("hu");
    expect(row?.source).toBe("landing");
    expect(row?.token_hash).toBeTruthy();

    const consent = db
      .prepare("SELECT * FROM user_consents WHERE subject_kind = 'newsletter' AND subject_ref = ?")
      .get(String(row?.id)) as { document: string; version: string } | null;
    expect(consent?.document).toBe("privacy");
    expect(consent?.version).toBe(PRIVACY_VERSION);
  });

  test("confirm flips pending → confirmed; second click reports already", async () => {
    await req("POST", "/api/newsletter/subscribe", subscribeBody("nl2@example.com"));
    const token = tokenFor("nl2@example.com");

    const res = await req<{ ok: true; already: boolean }>("POST", "/api/newsletter/confirm", {
      token,
    });
    expect(res.status).toBe(200);
    expect(res.data.already).toBe(false);
    expect(subscriber("nl2@example.com")?.status).toBe("confirmed");

    const again = await req<{ ok: true; already: boolean }>("POST", "/api/newsletter/confirm", {
      token,
    });
    expect(again.status).toBe(200);
    expect(again.data.already).toBe(true);
  });

  test("expired confirm link answers 410; re-subscribe re-arms it", async () => {
    await req("POST", "/api/newsletter/subscribe", subscribeBody("nl3@example.com"));
    const token = tokenFor("nl3@example.com");
    const eightDaysMs = 8 * 24 * 60 * 60 * 1000;
    db.prepare(
      "UPDATE newsletter_subscribers SET token_created_at = token_created_at - ? WHERE email = ?",
    ).run(eightDaysMs, "nl3@example.com");

    const res = await req("POST", "/api/newsletter/confirm", { token });
    expect(res.status).toBe(410);
    expect(subscriber("nl3@example.com")?.status).toBe("pending");

    await req("POST", "/api/newsletter/subscribe", subscribeBody("nl3@example.com"));
    const fresh = tokenFor("nl3@example.com");
    expect(fresh).not.toBe(token);
    const confirmed = await req("POST", "/api/newsletter/confirm", { token: fresh });
    expect(confirmed.status).toBe(200);
    expect(subscriber("nl3@example.com")?.status).toBe("confirmed");
  });

  test("unsubscribe suppresses; old token dies after a re-subscribe", async () => {
    await req("POST", "/api/newsletter/subscribe", subscribeBody("nl4@example.com"));
    const token = tokenFor("nl4@example.com");
    await req("POST", "/api/newsletter/confirm", { token });

    const unsub = await req<{ ok: true; already: boolean }>("POST", "/api/newsletter/unsubscribe", {
      token,
    });
    expect(unsub.status).toBe(200);
    expect(unsub.data.already).toBe(false);
    expect(subscriber("nl4@example.com")?.status).toBe("unsubscribed");

    // Changing their mind goes back through double opt-in with a FRESH token —
    // the pre-unsubscribe link must no longer do anything.
    await req("POST", "/api/newsletter/subscribe", subscribeBody("nl4@example.com"));
    expect(subscriber("nl4@example.com")?.status).toBe("pending");
    const stale = await req("POST", "/api/newsletter/confirm", { token });
    expect(stale.status).toBe(404);
  });

  test("already-confirmed subscribe is a silent no-op (no token churn)", async () => {
    await req("POST", "/api/newsletter/subscribe", subscribeBody("nl5@example.com"));
    await req("POST", "/api/newsletter/confirm", { token: tokenFor("nl5@example.com") });
    const before = subscriber("nl5@example.com");

    const res = await req("POST", "/api/newsletter/subscribe", subscribeBody("nl5@example.com"));
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ ok: true });
    const after = subscriber("nl5@example.com");
    expect(after?.status).toBe("confirmed");
    expect(after?.token_hash).toBe(before?.token_hash ?? "");
  });

  test("input validation: bad email, stale privacy version, junk token", async () => {
    const badEmail = await req("POST", "/api/newsletter/subscribe", subscribeBody("not-an-email"));
    expect(badEmail.status).toBe(400);

    const staleVersion = await req(
      "POST",
      "/api/newsletter/subscribe",
      subscribeBody("nl6@example.com", { privacy_version: "1999-01-01" }),
    );
    expect(staleVersion.status).toBe(400);
    expect(subscriber("nl6@example.com")).toBeNull();

    const junk = await req("POST", "/api/newsletter/confirm", { token: "junk" });
    expect(junk.status).toBe(404);
  });
});
