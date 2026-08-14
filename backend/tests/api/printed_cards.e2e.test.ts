import "../setup";

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDesign } from "@shared/design";
import { normalizeMenuCardInput } from "@shared/menu_card";
import { PRINT_CARD_REGISTRY, PRINT_CARD_TYPES } from "@shared/print_cards";
import { db } from "../../src/db";
import { bootstrapCouple, req, wipeAll } from "../helpers";

const BASE = `http://localhost:${process.env.PORT ?? "8791"}`;
const outputDir = mkdtempSync(join(tmpdir(), "weddly-printed-cards-"));

afterAll(() => rmSync(outputDir, { recursive: true, force: true }));

function command(name: string, args: string[]): string {
  const result = Bun.spawnSync([name, ...args], { stderr: "pipe", stdout: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(`${name} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

/** Assert that every extractable glyph box is inside its physical PDF page.
 *  Text extraction alone still succeeds when a renderer draws a complete
 *  string beyond the trim edge, which is exactly the preview/print mismatch
 *  this audit is meant to prevent. */
function expectTextInsidePages(path: string): void {
  const bbox = command("pdftotext", ["-bbox", path, "-"]);
  const pages = [...bbox.matchAll(/<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g)];
  expect(pages.length).toBeGreaterThan(0);
  for (const page of pages) {
    const width = Number(page[1]);
    const height = Number(page[2]);
    const body = page[3] ?? "";
    for (const word of body.matchAll(
      /<word xMin="(-?[\d.]+)" yMin="(-?[\d.]+)" xMax="(-?[\d.]+)" yMax="(-?[\d.]+)">/g,
    )) {
      const [, xMinRaw, yMinRaw, xMaxRaw, yMaxRaw] = word;
      const [xMin, yMin, xMax, yMax] = [xMinRaw, yMinRaw, xMaxRaw, yMaxRaw].map(Number);
      expect(xMin).toBeGreaterThanOrEqual(-0.1);
      expect(yMin).toBeGreaterThanOrEqual(-0.1);
      expect(xMax).toBeLessThanOrEqual(width + 0.1);
      expect(yMax).toBeLessThanOrEqual(height + 0.1);
    }
  }
}

async function fetchCard(token: string, cardType: (typeof PRINT_CARD_TYPES)[number]) {
  const definition = PRINT_CARD_REGISTRY[cardType];
  const response = await fetch(`${BASE}${definition.endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const path = join(outputDir, `${cardType}.pdf`);
  writeFileSync(path, bytes);
  return { response, bytes, path };
}

describe("Design -> Printed cards exports", () => {
  test("all six endpoints render the canonical workspace data and valid embedded fonts", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("printed-cards@weddly.test");
    const now = Date.now();
    const menu = normalizeMenuCardInput({
      courses: [
        { title: "Előétel", lines: ["Gulyás leves újházi módra"] },
        { title: "Főétel", lines: ["Árvíztűrő tükörfúrógép"] },
        { title: "Desszert", lines: ["ŐRÜLT ÁRVÍZTŰRŐ"] },
      ],
    });
    const design = resolveDesign({
      style: "garden_romance",
      borderStyle: "hairline",
      print: { border: true, ornament: true, qr: false },
    });
    db.prepare(
      `UPDATE couples SET display_name = ?, bride_name = ?, groom_name = ?,
       wedding_date = ?, venue_name = ?, venue_city = ?, country = ?, menu_card = ?,
       design_json = ?, updated_at = ? WHERE id = ?`,
    ).run(
      "Andor & Sári",
      "Sári",
      "Andor",
      "2027-05-29",
      "Árvíztűrő Udvar",
      "Győr",
      "HU",
      JSON.stringify(menu),
      JSON.stringify(design),
      now,
      coupleId,
    );
    db.prepare(
      `UPDATE users SET locale = 'hu' WHERE id =
       (SELECT user_id FROM couple_members WHERE couple_id = ? LIMIT 1)`,
    ).run(coupleId);

    const table = await req<{ table: { id: number; updated_at: number } }>(
      "POST",
      "/api/seating/tables",
      {
        label: "12",
        shape: "round",
        seats: 12,
        x_mm: 0,
        y_mm: 0,
        width_mm: 3000,
        length_mm: 3000,
      },
      { token },
    );
    expect(table.status).toBe(201);

    const guestNames = [
      "Andor & Sári",
      "Árvíztűrő tükörfúrógép",
      "Előétel",
      "Gulyás leves újházi módra",
      "ŐRÜLT ÁRVÍZTŰRŐ",
      "Á É Í Ó Ö Ő Ú Ü Ű",
      "Kovács-Szűcs D'Árvíz",
      "Alexandra-Magdolna Őz",
      "Bálint Ürmös",
      "Csősz Írisz",
      "Zsófia Tűzkő",
    ];
    let firstGuestId = 0;
    let firstGuestUpdatedAt = 0;
    for (const full_name of guestNames) {
      const guest = await req<{ guest: { id: number; updated_at: number } }>(
        "POST",
        "/api/guests",
        { full_name },
        { token },
      );
      expect(guest.status).toBe(201);
      if (!firstGuestId) {
        firstGuestId = guest.data.guest.id;
        firstGuestUpdatedAt = guest.data.guest.updated_at;
      }
    }
    const assignment = await req(
      "POST",
      "/api/seating/assign",
      { table_id: table.data.table.id, seat_index: 0, guest_id: firstGuestId },
      { token },
    );
    expect(assignment.status).toBe(200);

    const scheduleEvents: Array<{ id: number; updated_at: number }> = [];
    for (const event of [
      { label: "Naplementés fogadalom", starts_at_minutes: 16 * 60 + 45, is_key_moment: true },
      {
        label: "Gyertyafényes vacsora újházi módra",
        starts_at_minutes: 19 * 60 + 15,
        is_key_moment: true,
      },
      { label: "Első tánc", starts_at_minutes: 21 * 60, is_key_moment: true },
    ]) {
      const created = await req<{ event: { id: number; updated_at: number } }>(
        "POST",
        "/api/schedule",
        event,
        { token },
      );
      expect(created.status).toBe(201);
      scheduleEvents.push(created.data.event);
    }

    const expectedPage = {
      place_card: "595.276 x 841.891",
      table_number: "419.528 x 297.638",
      menu: "419.528 x 595.276",
      invitation: "419.528 x 595.276",
      thank_you: "297.638 x 419.528",
      schedule: "419.528 x 595.276",
    } as const;
    const textByCard = new Map<string, string>();
    const revisionByCard = new Map<string, string>();

    for (const cardType of PRINT_CARD_TYPES) {
      const { response, bytes, path } = await fetchCard(token, cardType);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toStartWith("application/pdf");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-weddly-card-type")).toBe(cardType);
      expect(response.headers.get("x-weddly-data-revision")).toStartWith(`${cardType}:`);
      revisionByCard.set(cardType, response.headers.get("x-weddly-data-revision")!);
      expect(bytes.length).toBeGreaterThan(5_000);
      expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");

      const info = command("pdfinfo", [path]);
      expect(info).toContain(`Page size:       ${expectedPage[cardType]} pts`);
      const fonts = command("pdffonts", [path]);
      expect(fonts).toContain("yes");
      expect(fonts).toContain("CormorantGaramond-Italic");
      const text = command("pdftotext", [path, "-"]);
      textByCard.set(cardType, text);
      expect(text).not.toContain("Anna & Bence");
      expect(text).not.toContain("20 June 2027");

      const rasterPrefix = join(outputDir, `${cardType}-raster`);
      command("pdftoppm", ["-f", "1", "-singlefile", "-r", "72", path, rasterPrefix]);
      const raster = readFileSync(`${rasterPrefix}.ppm`);
      expect(raster.length).toBeGreaterThan(20_000);
      // A blank/corrupt capture is overwhelmingly white. Requiring a healthy
      // amount of ink catches missing cards before the pixel baseline test.
      let inkBytes = 0;
      for (const byte of raster.subarray(raster.indexOf(10, 3) + 1)) {
        if (byte < 245) inkBytes += 1;
      }
      expect(inkBytes).toBeGreaterThan(1_000);
    }

    expect(textByCard.get("invitation")).toContain("Andor & Sári");
    expect(textByCard.get("invitation")).toContain("Árvíztűrő Udvar");
    expect(textByCard.get("thank_you")).toContain("Köszönjük");
    expect(textByCard.get("thank_you")).toContain("2027. május 29.");
    expect(textByCard.get("menu")).toContain("Gulyás leves újházi módra");
    expect(textByCard.get("menu")).toContain("ŐRÜLT ÁRVÍZTŰRŐ");
    expect(textByCard.get("table_number")).toContain("12");
    const compactPlaceText = textByCard.get("place_card")?.replace(/\s/g, "");
    for (const guestName of guestNames) {
      expect(compactPlaceText).toContain(guestName.replace(/\s/g, ""));
    }
    expect(command("pdfinfo", [join(outputDir, "place_card.pdf")])).toContain("Pages:           2");
    expect(textByCard.get("schedule")).toContain("Program");
    expect(textByCard.get("schedule")).toContain("Naplementés fogadalom");
    expect(textByCard.get("schedule")).not.toContain("Run of show");
    expect(textByCard.get("schedule")).not.toContain("WEDDLY");

    // Seat assignments have no updated_at column. Their relationship values
    // still participate in the revision, so a saved move cannot leave preview
    // and download advertising the previous data version.
    const secondTable = await req<{ table: { id: number } }>(
      "POST",
      "/api/seating/tables",
      {
        label: "Őrség",
        shape: "round",
        seats: 6,
        x_mm: 4000,
        y_mm: 0,
        width_mm: 3000,
        length_mm: 3000,
      },
      { token },
    );
    expect(secondTable.status).toBe(201);
    expect(
      (
        await req(
          "POST",
          "/api/seating/assign",
          { table_id: secondTable.data.table.id, seat_index: 0, guest_id: firstGuestId },
          { token },
        )
      ).status,
    ).toBe(200);
    const movedPlaceCard = await fetchCard(token, "place_card");
    expect(movedPlaceCard.response.headers.get("x-weddly-data-revision")).not.toBe(
      revisionByCard.get("place_card"),
    );
    expect(command("pdftotext", [movedPlaceCard.path, "-"])).toContain("Őrség");

    // Full edit -> export loop. Every card source is changed through its real
    // HTTP writer, then fetched again through the registry endpoint. This is
    // deliberately done without sleeps: revision hashes must include the text
    // itself and remain correct even when two writes share a millisecond stamp.
    const editedMenu = normalizeMenuCardInput({
      courses: Array.from({ length: 6 }, (_, courseIndex) => ({
        title: `Edited course ${courseIndex + 1}`,
        lines: Array.from(
          { length: 6 },
          (_, lineIndex) =>
            `Edited dish ${courseIndex + 1}.${lineIndex + 1} rosemary vegetables and citrus sauce`,
        ),
      })),
    });
    const coupleEdit = await req(
      "PATCH",
      "/api/couples/current",
      {
        bride_name: "Réka",
        groom_name: "Márton",
        wedding_date: "2028-09-17",
        venue_name:
          "Edited Riverside Glasshouse with the complete garden terrace and the old oak courtyard",
        venue_city: "Szentendre",
        menu_card: editedMenu,
      },
      { token },
    );
    expect(coupleEdit.status).toBe(200);

    const editedGuest =
      "Edited Guest Alexandra-Magdolna Kovács-Szűcs D'Árvíz with every saved family name";
    expect(
      (
        await req(
          "PATCH",
          `/api/guests/${firstGuestId}`,
          { full_name: editedGuest },
          { token, headers: { "If-Match": String(firstGuestUpdatedAt) } },
        )
      ).status,
    ).toBe(200);

    const editedTable =
      "Επεξεργασμένο τραπέζι οικογένειας και φίλων με ολόκληρη την αποθηκευμένη ετικέτα";
    expect(
      (
        await req(
          "PATCH",
          `/api/seating/tables/${table.data.table.id}`,
          { label: editedTable },
          { token, headers: { "If-Match": String(table.data.table.updated_at) } },
        )
      ).status,
    ).toBe(200);

    const editedSchedule =
      "Edited candlelit garden ceremony with the complete processional and family welcome text";
    expect(
      (
        await req(
          "PATCH",
          `/api/schedule/${scheduleEvents[0]!.id}`,
          { label: editedSchedule },
          { token, headers: { "If-Match": String(scheduleEvents[0]!.updated_at) } },
        )
      ).status,
    ).toBe(200);

    const editedTextByCard = new Map<string, string>();
    for (const cardType of PRINT_CARD_TYPES) {
      const edited = await fetchCard(token, cardType);
      expect(edited.response.headers.get("x-weddly-data-revision")).not.toBe(
        revisionByCard.get(cardType),
      );
      const text = command("pdftotext", [edited.path, "-"]);
      editedTextByCard.set(cardType, text);
      expect(text).not.toContain("Anna & Bence");
      expect(text).not.toContain("…");
      expectTextInsidePages(edited.path);
    }

    expect(editedTextByCard.get("invitation")).toContain("Réka & Márton");
    expect(editedTextByCard.get("invitation")).toContain("Edited Riverside Glasshouse");
    expect(editedTextByCard.get("invitation")).toContain("Szentendre");
    expect(editedTextByCard.get("thank_you")).toContain("Réka & Márton");
    expect(editedTextByCard.get("thank_you")).toContain("2028. szeptember 17.");
    expect(editedTextByCard.get("schedule")?.replace(/\s/g, "")).toContain(
      editedSchedule.replace(/\s/g, ""),
    );
    expect(editedTextByCard.get("menu")).toContain("Edited course 1");
    expect(editedTextByCard.get("menu")).toContain("Edited dish 6.6");
    expect(command("pdfinfo", [join(outputDir, "menu.pdf")])).toMatch(/Pages:\s+[2-9]/);
    expect(editedTextByCard.get("table_number")?.replace(/\s/g, "")).toContain(
      editedTable.replace(/\s/g, ""),
    );
    expect(editedTextByCard.get("place_card")?.replace(/\s/g, "")).toContain(
      editedGuest.replace(/\s/g, ""),
    );

    // The operational document intentionally remains available to the
    // Schedule page, but the card registry must never point to it.
    const runOfShow = await fetch(`${BASE}/api/print/schedule`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const runOfShowPath = join(outputDir, "run-of-show.pdf");
    writeFileSync(runOfShowPath, new Uint8Array(await runOfShow.arrayBuffer()));
    expect(command("pdftotext", [runOfShowPath, "-"])).toContain("Run of show");
  }, 30_000);
});
