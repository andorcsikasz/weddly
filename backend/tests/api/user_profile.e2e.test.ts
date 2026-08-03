// PATCH /api/users/me — user-self profile edits (full_name + locale).
// Adjacent to the existing GET /api/auth/me (covered in auth.e2e.test.ts);
// kept separate because the route lives in its own file per the
// one-file-per-feature convention in CLAUDE.md.

import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, req } from "../helpers";

interface UserDTO {
  id: number;
  email: string;
  full_name: string;
  locale: "hu" | "en" | null;
}

describe("PATCH /api/users/me", () => {
  test("requires auth", async () => {
    const r = await req("PATCH", "/api/users/me", { full_name: "Anyone" });
    expect(r.status).toBe(401);
  });

  test("renames the user and reflects the new name on /api/auth/me", async () => {
    const { token } = await bootstrapCouple("rename@weddly.test");
    const r = await req<{ user: UserDTO }>(
      "PATCH",
      "/api/users/me",
      { full_name: "Anna Csikász" },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.user.full_name).toBe("Anna Csikász");

    const me = await req<{ user: UserDTO }>("GET", "/api/auth/me", undefined, { token });
    expect(me.data.user.full_name).toBe("Anna Csikász");
  });

  test("trims whitespace on rename", async () => {
    const { token } = await bootstrapCouple("trim@weddly.test");
    const r = await req<{ user: UserDTO }>(
      "PATCH",
      "/api/users/me",
      { full_name: "   Bence   " },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.user.full_name).toBe("Bence");
  });

  test("rejects an empty / 201-char name", async () => {
    const { token } = await bootstrapCouple("invalid@weddly.test");
    const r1 = await req("PATCH", "/api/users/me", { full_name: "   " }, { token });
    expect(r1.status).toBe(400);
    const r2 = await req("PATCH", "/api/users/me", { full_name: "x".repeat(201) }, { token });
    expect(r2.status).toBe(400);
  });

  test("rejects a non-string name", async () => {
    const { token } = await bootstrapCouple("typeerror@weddly.test");
    const r = await req("PATCH", "/api/users/me", { full_name: 42 }, { token });
    expect(r.status).toBe(400);
  });

  test("sets locale to hu / en, and clears it via null", async () => {
    const { token } = await bootstrapCouple("locale@weddly.test");

    const en = await req<{ user: UserDTO }>("PATCH", "/api/users/me", { locale: "en" }, { token });
    expect(en.status).toBe(200);
    expect(en.data.user.locale).toBe("en");

    const hu = await req<{ user: UserDTO }>("PATCH", "/api/users/me", { locale: "hu" }, { token });
    expect(hu.data.user.locale).toBe("hu");

    const cleared = await req<{ user: UserDTO }>(
      "PATCH",
      "/api/users/me",
      { locale: null },
      { token },
    );
    expect(cleared.data.user.locale).toBe(null);
  });

  test("rejects an unknown locale code", async () => {
    const { token } = await bootstrapCouple("bad-locale@weddly.test");
    // "de" used to stand in for "unknown" here. German ships as a UI locale
    // now, so the example has to be a code we genuinely do not serve, or the
    // test passes for the wrong reason the day we add the language.
    const r = await req("PATCH", "/api/users/me", { locale: "fr" }, { token });
    expect(r.status).toBe(400);
  });

  test("no-op patch returns the current row unchanged", async () => {
    const { token } = await bootstrapCouple("noop@weddly.test");
    const before = await req<{ user: UserDTO }>("GET", "/api/auth/me", undefined, { token });

    const after = await req<{ user: UserDTO }>("PATCH", "/api/users/me", {}, { token });
    expect(after.status).toBe(200);
    expect(after.data.user.full_name).toBe(before.data.user.full_name);
    expect(after.data.user.locale).toBe(before.data.user.locale);
  });

  test("name + locale in one request both land", async () => {
    const { token } = await bootstrapCouple("both@weddly.test");
    const r = await req<{ user: UserDTO }>(
      "PATCH",
      "/api/users/me",
      { full_name: "Csenge", locale: "en" },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.user.full_name).toBe("Csenge");
    expect(r.data.user.locale).toBe("en");
  });
});
