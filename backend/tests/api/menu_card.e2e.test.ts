// The printed menu card's CONTENT (`couples.menu_card`).
//
// The A5 menu card used to draw three hardcoded English course labels over
// blank writing rules, and there was no screen anywhere in the product where a
// couple could type a dish. A couple asked how to edit it; the honest answer
// was that they could not. These cases pin the storage contract and the two
// things about it that are easy to break later: an empty menu must keep
// rendering the fill-in-by-hand card, and the PATCH must stay partial so a
// body about the menu can't blank the design.

import "../setup";

import { describe, expect, test } from "bun:test";
import { req, wipeAll, bootstrapCouple } from "../helpers";
import { MENU_MAX_COURSES, MENU_MAX_LINES, MENU_TITLE_MAX } from "@shared/menu_card";
import type { MenuCard } from "@shared/types";

const BASE = `http://localhost:${process.env.PORT ?? "8791"}`;

async function expectMenuPdf(token: string): Promise<number> {
  const res = await fetch(`${BASE}/api/print/menu`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("application/pdf");
  const bytes = new Uint8Array(await res.arrayBuffer());
  expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("%PDF");
  return bytes.byteLength;
}

async function setMenu(token: string, menu: unknown) {
  return req<{ couple: { menu_card: MenuCard } }>(
    "PATCH",
    "/api/couples/current",
    { menu_card: menu },
    { token },
  );
}

async function readMenu(token: string): Promise<MenuCard> {
  const r = await req<{ couple: { menu_card: MenuCard } }>(
    "GET",
    "/api/couples/current",
    undefined,
    { token },
  );
  return r.data.couple.menu_card;
}

describe("menu card content", () => {
  test("a couple can write their courses and read them back", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("menu-write@weddly.test");

    // Every couple starts empty: the card still prints, it just prints rules.
    expect(await readMenu(token)).toEqual({ courses: [] });

    const r = await setMenu(token, {
      courses: [
        { title: "Előétel", lines: ["Libamáj brióssal"] },
        { title: "Főétel", lines: ["Marhapofa vörösborban", "Sült pisztráng"] },
        { title: "Desszert", lines: ["Somlói galuska"] },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.data.couple.menu_card.courses).toHaveLength(3);
    expect(r.data.couple.menu_card.courses[1]?.lines).toEqual([
      "Marhapofa vörösborban",
      "Sült pisztráng",
    ]);
    expect((await readMenu(token)).courses[0]?.title).toBe("Előétel");
  });

  test("the PDF renders with a written menu and with an empty one", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("menu-pdf@weddly.test");

    // Empty: the fill-in-by-hand card. This is the path every existing couple
    // is on and it must never stop rendering.
    const blank = await expectMenuPdf(token);

    await setMenu(token, {
      courses: [
        { title: "Amuse-bouche", lines: ["Kecskesajt-krém"] },
        { title: "Leves", lines: ["Céklaleves tormahabbal"] },
        { title: "Főétel", lines: ["Kacsamell szilvamártással", "Sült zöldségek"] },
        { title: "Desszert", lines: ["Csokoládétorta"] },
      ],
    });
    const written = await expectMenuPdf(token);
    // The dishes are actually on the page, so the stream is meaningfully
    // bigger than the blank card's.
    expect(written).toBeGreaterThan(blank);
  });

  test("over-long input is trimmed rather than rejected", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("menu-caps@weddly.test");

    const r = await setMenu(token, {
      courses: Array.from({ length: MENU_MAX_COURSES + 3 }, () => ({
        title: "x".repeat(MENU_TITLE_MAX + 20),
        lines: Array.from({ length: MENU_MAX_LINES + 4 }, (_, i) => `dish ${i}`),
      })),
    });
    expect(r.status).toBe(200);
    const menu = r.data.couple.menu_card;
    expect(menu.courses).toHaveLength(MENU_MAX_COURSES);
    expect(menu.courses[0]?.title.length).toBe(MENU_TITLE_MAX);
    expect(menu.courses[0]?.lines).toHaveLength(MENU_MAX_LINES);
    // And it still prints at the cap rather than running off the page.
    await expectMenuPdf(token);
  });

  test("empty rows are dropped, not stored as gaps in the printed card", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("menu-empty-rows@weddly.test");

    const r = await setMenu(token, {
      courses: [
        { title: "Főétel", lines: ["Marhapofa"] },
        { title: "   ", lines: ["  ", ""] }, // the editor's untouched blank row
        { title: "", lines: ["Somlói galuska"] }, // dishes with no heading: kept
      ],
    });
    expect(r.status).toBe(200);
    const courses = r.data.couple.menu_card.courses;
    expect(courses).toHaveLength(2);
    expect(courses[1]?.title).toBe("");
    expect(courses[1]?.lines).toEqual(["Somlói galuska"]);
  });

  test("junk degrades to the empty menu instead of breaking the print route", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("menu-junk@weddly.test");

    for (const junk of ["not an object", 42, [], { courses: "nope" }, { nope: true }]) {
      // Re-seed each round: junk resolves to the EMPTY menu, so without this
      // every case after the first would be a no-op rather than a real test.
      expect(
        (await setMenu(token, { courses: [{ title: "Főétel", lines: ["Marhapofa"] }] })).status,
      ).toBe(200);
      const r = await setMenu(token, junk);
      expect(r.status).toBe(200);
      expect(r.data.couple.menu_card).toEqual({ courses: [] });
    }
    await expectMenuPdf(token);
  });

  test("a menu PATCH leaves the design alone", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("menu-partial@weddly.test");
    await req(
      "PATCH",
      "/api/couples/current",
      { design: { style: "midnight_luxe", palette: "espresso" } },
      { token },
    );

    await setMenu(token, { courses: [{ title: "Főétel", lines: ["Marhapofa"] }] });

    // The PATCH is partial by contract; a body about one field must not reset
    // the fourteen it says nothing about.
    const after = await req<{ couple: { design: { style: string; palette: string } } }>(
      "GET",
      "/api/couples/current",
      undefined,
      { token },
    );
    expect(after.data.couple.design.style).toBe("midnight_luxe");
    expect(after.data.couple.design.palette).toBe("espresso");
  });

  test("a no-op menu PATCH is refused like every other no-op", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("menu-noop@weddly.test");
    const menu = { courses: [{ title: "Főétel", lines: ["Marhapofa"] }] };

    expect((await setMenu(token, menu)).status).toBe(200);
    // Re-sending the identical menu changes nothing, so the handler has
    // nothing to write. Same behaviour as the design + meal_menu fields.
    const again = await setMenu(token, menu);
    expect(again.status).toBe(400);
  });
});
