import { beforeEach, describe, expect, test } from "bun:test";
import "../setup";
import type { TranslateAvailability, TranslateResult } from "@shared/translate";
import { registerAndVerify, req, wipeAll } from "../helpers";

// Runs with DEEPL_FAKE=1 + DEEPL_API_KEY pinned (tests/setup.ts): the provider
// answers from a deterministic stub ("[EN] ..." / "[HU] ...") so these tests
// exercise the full route -> lib pipeline without ever touching DeepL.

async function registerVerified(email: string): Promise<{ token: string }> {
  const reg = await registerAndVerify({
    email,
    password: "supersafe123",
    full_name: "Translate Person",
  });
  expect(reg.status).toBe(201);
  return { token: reg.data.token };
}

describe("translate: availability", () => {
  test("reports available when a DeepL key is configured", async () => {
    const r = await req<TranslateAvailability>("GET", "/api/translate/availability");
    expect(r.status).toBe(200);
    expect(r.data.available).toBe(true);
  });
});

describe("translate: POST /api/translate", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("requires auth", async () => {
    const r = await req("POST", "/api/translate", { text: "Szia", source: "HU", target: "EN" });
    expect(r.status).toBe(401);
  });

  test("translates HU -> EN", async () => {
    const { token } = await registerVerified("t-hu-en@test.test");
    const r = await req<TranslateResult>(
      "POST",
      "/api/translate",
      { text: "Mesebeli esküvői torták", source: "HU", target: "EN" },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.text).toBe("[EN] Mesebeli esküvői torták");
  });

  test("translates EN -> HU", async () => {
    const { token } = await registerVerified("t-en-hu@test.test");
    const r = await req<TranslateResult>(
      "POST",
      "/api/translate",
      { text: "Fairy-tale wedding cakes", source: "EN", target: "HU" },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.text).toBe("[HU] Fairy-tale wedding cakes");
  });

  test("trims the input before translating", async () => {
    const { token } = await registerVerified("t-trim@test.test");
    const r = await req<TranslateResult>(
      "POST",
      "/api/translate",
      { text: "  hello  ", source: "EN", target: "HU" },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.text).toBe("[HU] hello");
  });

  test("rejects blank text", async () => {
    const { token } = await registerVerified("t-empty@test.test");
    const r = await req(
      "POST",
      "/api/translate",
      { text: "   ", source: "HU", target: "EN" },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("rejects identical source and target", async () => {
    const { token } = await registerVerified("t-same@test.test");
    const r = await req(
      "POST",
      "/api/translate",
      { text: "hi", source: "EN", target: "EN" },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("rejects a language outside the closed union", async () => {
    const { token } = await registerVerified("t-lang@test.test");
    // "DE" used to be the example here. German is a real target now — a vendor
    // in Austria or Germany writes their own-language description in it — so
    // the case has to be a language the union genuinely excludes, or the test
    // passes for the wrong reason. The union stays closed on purpose: opening
    // it to everything DeepL does would make this a general-purpose
    // translation API on someone else's bill.
    for (const target of ["JA", "ZH", "XX", "", 42]) {
      const r = await req("POST", "/api/translate", { text: "hi", source: "HU", target }, { token });
      expect(r.status).toBe(400);
    }
  });

  test("accepts a language a vendor's own country actually maps to", async () => {
    const { token } = await registerVerified("t-lang-de@test.test");
    const r = await req<{ text: string }>(
      "POST",
      "/api/translate",
      { text: "hello", source: "EN", target: "DE" },
      { token },
    );
    expect(r.status).toBe(200);
  });

  test("rejects over-long text", async () => {
    const { token } = await registerVerified("t-long@test.test");
    const r = await req(
      "POST",
      "/api/translate",
      { text: "a".repeat(2001), source: "HU", target: "EN" },
      { token },
    );
    expect(r.status).toBe(400);
  });
});
