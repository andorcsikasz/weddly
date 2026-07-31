// `couples.country` lifecycle: onboarding ships a country, PATCH updates
// it (and writes an audit row), additional workspaces inherit from or
// override the active workspace, and bad ISO codes are 400'd at the
// boundary. The column itself + its default value are validated in
// schema/migration tests; this file owns the wire contract.

import "../setup";

import { describe, expect, test } from "bun:test";
import { req, wipeAll, registerAndVerify } from "../helpers";
import { db } from "../../src/db";

async function registerVerified(email: string): Promise<string> {
  const r = await registerAndVerify({
    email,
    password: "supersafe123",
    full_name: "Kata Ország",
  });
  expect(r.status).toBe(201);
  return r.data.token;
}

async function onboard(
  token: string,
  body: Record<string, unknown>,
): Promise<{ couple: { id: number; country: string } }> {
  const r = await req<{ couple: { id: number; country: string } }>(
    "POST",
    "/api/couples/onboard",
    {
      display_name: "Mia & Lucas",
      wedding_date_goal: { kind: "tbd", exact_date: null },
      guest_count_goal: { kind: "tbd" },
      budget_goal: { kind: "tbd" },
      ...body,
    },
    { token },
  );
  expect(r.status).toBe(201);
  return r.data;
}

describe("couples.country: onboarding", () => {
  test("onboarding persists the ISO 3166-1 country code", async () => {
    wipeAll();
    const token = await registerVerified("country-onboard@weddly.test");
    const { couple } = await onboard(token, { country: "BE" });
    expect(couple.country).toBe("BE");
  });

  test("onboarding lowercases the country code into the DB as uppercase", async () => {
    wipeAll();
    const token = await registerVerified("country-lowercase@weddly.test");
    const { couple } = await onboard(token, { country: "fr" });
    expect(couple.country).toBe("FR");
  });

  test("onboarding without country falls back to HU (legacy default)", async () => {
    wipeAll();
    const token = await registerVerified("country-default@weddly.test");
    const { couple } = await onboard(token, {});
    expect(couple.country).toBe("HU");
  });

  test("onboarding with an unknown country code is rejected with 400", async () => {
    wipeAll();
    const token = await registerVerified("country-bad@weddly.test");
    const r = await req(
      "POST",
      "/api/couples/onboard",
      {
        display_name: "Mia & Lucas",
        wedding_date_goal: { kind: "tbd", exact_date: null },
        guest_count_goal: { kind: "tbd" },
        budget_goal: { kind: "tbd" },
        country: "ZZ",
      },
      { token },
    );
    expect(r.status).toBe(400);
  });
});

describe("couples.country: PATCH /api/couples/current", () => {
  test("PATCH country updates the column and writes an audit row", async () => {
    wipeAll();
    const token = await registerVerified("country-patch@weddly.test");
    const { couple } = await onboard(token, { country: "HU" });
    const r = await req<{ couple: { country: string } }>(
      "PATCH",
      "/api/couples/current",
      { country: "BE" },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.couple.country).toBe("BE");
    const audit = db
      .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE couple_id = ? AND action = ?")
      .get(couple.id, "couple.country_update") as { n: number };
    expect(audit.n).toBe(1);
  });

  test("PATCH country with a bad code rejects with 400 and does NOT update", async () => {
    wipeAll();
    const token = await registerVerified("country-patch-bad@weddly.test");
    await onboard(token, { country: "HU" });
    const r = await req("PATCH", "/api/couples/current", { country: "XX" }, { token });
    expect(r.status).toBe(400);
    const stored = db.prepare("SELECT country FROM couples").get() as { country: string };
    expect(stored.country).toBe("HU");
  });

  test("PATCH country to the same value writes no audit row", async () => {
    wipeAll();
    const token = await registerVerified("country-patch-noop@weddly.test");
    const { couple } = await onboard(token, { country: "DE" });
    // The whole endpoint 400s when no field changed (handler-wide guard) —
    // the regression we care about is "no audit pollution", asserted below.
    const r = await req("PATCH", "/api/couples/current", { country: "DE" }, { token });
    expect(r.status).toBe(400);
    const audit = db
      .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE couple_id = ? AND action = ?")
      .get(couple.id, "couple.country_update") as { n: number };
    expect(audit.n).toBe(0);
  });
});

describe("couples.country: POST /api/couples (additional workspace)", () => {
  test("creating an additional workspace without country inherits the active workspace's country", async () => {
    wipeAll();
    const token = await registerVerified("country-add-inherit@weddly.test");
    await onboard(token, { country: "IT" });
    const r = await req<{ couple: { country: string } }>(
      "POST",
      "/api/couples",
      {
        event_name: "Religious ceremony",
        wedding_date_goal: { kind: "tbd", exact_date: null },
      },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.couple.country).toBe("IT");
  });

  test("creating an additional workspace can override the country (destination event)", async () => {
    wipeAll();
    const token = await registerVerified("country-add-override@weddly.test");
    await onboard(token, { country: "HU" });
    const r = await req<{ couple: { country: string } }>(
      "POST",
      "/api/couples",
      {
        event_name: "Beach afterparty",
        wedding_date_goal: { kind: "tbd", exact_date: null },
        country: "GR",
      },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.couple.country).toBe("GR");
  });

  test("additional workspace with a bad country code is rejected with 400", async () => {
    wipeAll();
    const token = await registerVerified("country-add-bad@weddly.test");
    await onboard(token, { country: "HU" });
    const r = await req(
      "POST",
      "/api/couples",
      {
        event_name: "Bad country event",
        wedding_date_goal: { kind: "tbd", exact_date: null },
        country: "QQ",
      },
      { token },
    );
    expect(r.status).toBe(400);
  });
});
