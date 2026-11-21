// A "do it myself" supplier card can carry the couple's own picture.
//
// Pins the same contract the cover photo has, because a DIY card is shown next
// to directory cards and must not become a back door for arbitrary files:
//   - the real magic bytes decide the type, not the client's Content-Type;
//   - the shared size cap applies;
//   - only the couple who owns the card can change its picture;
//   - removing the picture leaves the card itself alone.
//
// Covers routes/couple_suppliers.ts (photo routes) and domain/couple_suppliers.ts
// (setPhotoUrl, photo_url on the DTO).

import "../setup";
import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { bootstrapCouple, req, wipeAll } from "../helpers";

const BASE = `http://localhost:${process.env.PORT ?? "8791"}`;
const UPLOADS_DIR = process.env.UPLOADS_DIR ?? "./data/test-uploads";

/** 67-byte 1x1 transparent PNG, the same fixture the cover and site-photo
 *  suites use. */
function tinyPng(): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ]);
}

async function uploadPhoto(
  token: string | null,
  supplierId: string,
  blob: Blob,
): Promise<Response> {
  const form = new FormData();
  form.append("file", blob, "card.png");
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return await fetch(`${BASE}/api/couple-suppliers/${supplierId}/photo`, {
    method: "POST",
    headers,
    body: form,
  });
}

async function createDiy(token: string, name: string): Promise<string> {
  const r = await req<{ supplier: { id: string; photo_url: string | null } }>(
    "POST",
    "/api/couple-suppliers",
    { name, category: "photography" },
    { token },
  );
  expect(r.status).toBe(201);
  expect(r.data.supplier.photo_url).toBeNull();
  return r.data.supplier.id;
}

describe("DIY supplier card photo", () => {
  beforeAll(() => {
    wipeAll();
  });

  test("the couple can add a picture; the card reports it and the file is stored", async () => {
    const { token, coupleId } = await bootstrapCouple("diy-photo-add@weddly.test");
    const id = await createDiy(token, "Anyu fotózik");

    const r = await uploadPhoto(token, id, new Blob([tinyPng()], { type: "image/png" }));
    expect(r.status).toBe(200);
    const body = (await r.json()) as { supplier: { id: string; photo_url: string | null } };
    expect(body.supplier.id).toBe(id);
    expect(body.supplier.photo_url).toMatch(
      new RegExp(`^/uploads/couples/${coupleId}/supplier-${id}\\.png\\?v=\\d+$`),
    );
    expect(existsSync(join(UPLOADS_DIR, `couples/${coupleId}/supplier-${id}.png`))).toBe(true);

    // The card shows it through the public uploads URL, so that URL must serve it.
    const served = await fetch(`${BASE}${body.supplier.photo_url}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toContain("image/png");

    // It survives a fresh read of the list, so a reload keeps the picture.
    const list = await req<{ suppliers: { id: string; photo_url: string | null }[] }>(
      "GET",
      "/api/couple-suppliers",
      undefined,
      { token },
    );
    expect(list.data.suppliers.find((s) => s.id === id)?.photo_url).toBe(body.supplier.photo_url);
  });

  test("a file that is not an image is refused, whatever the Content-Type says", async () => {
    const { token } = await bootstrapCouple("diy-photo-fake@weddly.test");
    const id = await createDiy(token, "Hamis kép");

    const text = await uploadPhoto(
      token,
      id,
      new Blob([new TextEncoder().encode("not a picture")], { type: "image/png" }),
    );
    expect(text.status).toBe(415);

    const pdf = await uploadPhoto(token, id, new Blob(["%PDF-1.4"], { type: "application/pdf" }));
    expect(pdf.status).toBe(415);

    const card = await req<{ suppliers: { name: string; photo_url: string | null }[] }>(
      "GET",
      "/api/couple-suppliers",
      undefined,
      { token },
    );
    expect(card.data.suppliers.find((s) => s.name === "Hamis kép")?.photo_url).toBeNull();
  });

  test("a picture over the shared size cap is refused", async () => {
    const { token } = await bootstrapCouple("diy-photo-big@weddly.test");
    const id = await createDiy(token, "Nagy kép");
    const huge = new Blob([new Uint8Array(4 * 1024 * 1024 + 1)], { type: "image/png" });
    const r = await uploadPhoto(token, id, huge);
    expect(r.status).toBe(413);
  });

  test("another couple cannot change this card's picture", async () => {
    const owner = await bootstrapCouple("diy-photo-owner@weddly.test");
    const other = await bootstrapCouple("diy-photo-other@weddly.test");
    const id = await createDiy(owner.token, "Csak a miénk");

    const r = await uploadPhoto(other.token, id, new Blob([tinyPng()], { type: "image/png" }));
    expect(r.status).toBe(404);

    const del = await req("DELETE", `/api/couple-suppliers/${id}/photo`, undefined, {
      token: other.token,
    });
    expect(del.status).toBe(404);
  });

  test("anonymous uploads are refused", async () => {
    const { token } = await bootstrapCouple("diy-photo-anon@weddly.test");
    const id = await createDiy(token, "Névtelen");
    const r = await uploadPhoto(null, id, new Blob([tinyPng()], { type: "image/png" }));
    expect(r.status).toBe(401);
  });

  test("removing the picture clears it and keeps the card and its name", async () => {
    const { token } = await bootstrapCouple("diy-photo-remove@weddly.test");
    const id = await createDiy(token, "Eltávolítható");
    await uploadPhoto(token, id, new Blob([tinyPng()], { type: "image/png" }));

    const del = await req<{ supplier: { name: string; photo_url: string | null } }>(
      "DELETE",
      `/api/couple-suppliers/${id}/photo`,
      undefined,
      { token },
    );
    expect(del.status).toBe(200);
    expect(del.data.supplier.photo_url).toBeNull();
    expect(del.data.supplier.name).toBe("Eltávolítható");
  });
});
