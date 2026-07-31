import "../setup";

import { describe, expect, test } from "bun:test";
import { req, wipeAll, registerAndVerify } from "../helpers";

/** Bootstrap a user against ADMIN_EMAILS (set in setup.ts) and return the
 *  bearer token. couple_card_feedback admin reads require an admin user. */
async function bootstrapAdmin(): Promise<string> {
  wipeAll();
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Ádám Nagy",
  });
  expect(reg.status).toBe(201);
  return reg.data.token;
}

interface AggregateRow {
  deck_id: string;
  card_index: number;
  locale: string;
  question_snapshot: string;
  bad_count: number;
  ok_count: number;
  great_count: number;
  total: number;
}

describe("couple-cards feedback", () => {
  test("anon visitors can POST a rating, admin aggregates show the tally", async () => {
    const adminToken = await bootstrapAdmin();

    // Three anon submissions on the same card, two different ratings.
    for (const rating of ["bad", "bad", "great"] as const) {
      const r = await req("POST", "/api/couple-cards/feedback", {
        deck_id: "closeness",
        card_index: 5,
        rating,
        locale: "hu",
        question_snapshot: "Mit jelent neked, ha melléd ülök a kanapéra szó nélkül?",
      });
      expect(r.status).toBe(200);
    }
    // One more on a different card so the aggregate has two rows.
    await req("POST", "/api/couple-cards/feedback", {
      deck_id: "closeness",
      card_index: 10,
      rating: "ok",
      locale: "hu",
      question_snapshot: "Mikor érezted utoljára, hogy egy mozdulatommal hazaértél?",
    });

    const list = await req<{ items: AggregateRow[] }>(
      "GET",
      "/api/admin/couple-cards/feedback",
      undefined,
      { token: adminToken },
    );
    expect(list.status).toBe(200);
    expect(list.data.items.length).toBe(2);

    // Default ordering surfaces highest bad_count first → the 2-bad card.
    const first = list.data.items[0]!;
    expect(first.deck_id).toBe("closeness");
    expect(first.card_index).toBe(5);
    expect(first.bad_count).toBe(2);
    expect(first.great_count).toBe(1);
    expect(first.total).toBe(3);
    expect(first.question_snapshot.length).toBeGreaterThan(0);
  });

  test("validates deck_id, rating, locale, card_index", async () => {
    wipeAll();
    const bad = [
      { deck_id: "nope", card_index: 0, rating: "bad", locale: "hu" },
      { deck_id: "roots", card_index: -1, rating: "bad", locale: "hu" },
      { deck_id: "roots", card_index: 25, rating: "bad", locale: "hu" },
      { deck_id: "roots", card_index: 0, rating: "love", locale: "hu" },
      { deck_id: "roots", card_index: 0, rating: "bad", locale: "fr" },
    ];
    for (const body of bad) {
      const r = await req("POST", "/api/couple-cards/feedback", body);
      expect(r.status).toBe(400);
    }
  });

  test("admin endpoint requires authentication", async () => {
    wipeAll();
    const anon = await req("GET", "/api/admin/couple-cards/feedback");
    expect(anon.status).toBe(401);
  });
});

interface SuggestionRow {
  id: number;
  deck_id: string;
  locale: string;
  suggestion: string;
  created_at: number;
}

describe("couple-cards suggestions (26th blank card)", () => {
  test("anon visitors can POST a suggestion, admin list returns it", async () => {
    const adminToken = await bootstrapAdmin();

    const submit = await req("POST", "/api/couple-cards/suggestions", {
      deck_id: "roots",
      locale: "hu",
      suggestion: "Mi az a családi mondat, amitől ma is megfagy a lábad?",
    });
    expect(submit.status).toBe(200);

    const list = await req<{ items: SuggestionRow[] }>(
      "GET",
      "/api/admin/couple-cards/suggestions",
      undefined,
      { token: adminToken },
    );
    expect(list.status).toBe(200);
    expect(list.data.items.length).toBe(1);
    const row = list.data.items[0]!;
    expect(row.deck_id).toBe("roots");
    expect(row.locale).toBe("hu");
    expect(row.suggestion.startsWith("Mi az a családi mondat")).toBe(true);
  });

  test("rejects too-short suggestions, unknown deck_id, bad locale", async () => {
    wipeAll();
    const bad = [
      { deck_id: "roots", locale: "hu", suggestion: "Rövid." }, // < 8 chars
      { deck_id: "unknown", locale: "hu", suggestion: "Elég hosszú javaslat ide." },
      { deck_id: "roots", locale: "fr", suggestion: "Elég hosszú javaslat ide." },
    ];
    for (const body of bad) {
      const r = await req("POST", "/api/couple-cards/suggestions", body);
      expect(r.status).toBe(400);
    }
  });

  test("admin suggestion endpoint requires authentication", async () => {
    wipeAll();
    const anon = await req("GET", "/api/admin/couple-cards/suggestions");
    expect(anon.status).toBe(401);
  });
});
