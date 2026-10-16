import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  _resetOutboxForTests,
  deleteShot,
  listShots,
  OUTBOX_TTL_MS,
  putShot,
} from "../../src/lib/film_outbox";

// happy-dom ships no IndexedDB. A fresh factory per test is a fresh "phone".
const g = globalThis as unknown as { indexedDB?: unknown; IDBKeyRange?: unknown };
const original = { indexedDB: g.indexedDB, IDBKeyRange: g.IDBKeyRange };

beforeEach(() => {
  g.indexedDB = new IDBFactory();
  g.IDBKeyRange = FakeIDBKeyRange;
  _resetOutboxForTests();
});

afterEach(() => {
  g.indexedDB = original.indexedDB;
  g.IDBKeyRange = original.IDBKeyRange;
  _resetOutboxForTests();
});

function jpeg(byte: number): Blob {
  return new Blob([new Uint8Array([0xff, 0xd8, 0xff, byte])], { type: "image/jpeg" });
}

describe("film outbox", () => {
  test("a shot survives until it is deleted, with its bytes intact", async () => {
    expect(
      await putShot({ id: "a", token: "film1", deviceId: "dev", blob: jpeg(1), createdAt: 10 }),
    ).toBe(true);

    // A new page load reopens the database from scratch.
    _resetOutboxForTests();
    const [restored] = await listShots("film1", 20);
    expect(restored?.id).toBe("a");
    expect(restored?.deviceId).toBe("dev");
    expect(new Uint8Array(await (restored as { blob: Blob }).blob.arrayBuffer())).toEqual(
      new Uint8Array([0xff, 0xd8, 0xff, 1]),
    );

    await deleteShot("a");
    expect(await listShots("film1", 20)).toEqual([]);
  });

  test("shots come back oldest first and only for their own film", async () => {
    await putShot({ id: "late", token: "film1", deviceId: "d", blob: jpeg(2), createdAt: 30 });
    await putShot({ id: "early", token: "film1", deviceId: "d", blob: jpeg(1), createdAt: 10 });
    await putShot({ id: "other", token: "film2", deviceId: "d", blob: jpeg(3), createdAt: 20 });
    expect((await listShots("film1", 40)).map((s) => s.id)).toEqual(["early", "late"]);
    expect((await listShots("film2", 40)).map((s) => s.id)).toEqual(["other"]);
  });

  test("a delete queued right behind the put still wins", async () => {
    // What a very fast upload does: the delete is issued before the put has
    // committed. IndexedDB serialises the two, so nothing is left behind.
    const put = putShot({ id: "fast", token: "f", deviceId: "d", blob: jpeg(1), createdAt: 1 });
    const del = deleteShot("fast");
    await Promise.all([put, del]);
    expect(await listShots("f", 2)).toEqual([]);
  });

  test("a shot older than the TTL is dropped instead of resent", async () => {
    await putShot({ id: "old", token: "f", deviceId: "d", blob: jpeg(1), createdAt: 0 });
    await putShot({ id: "new", token: "f", deviceId: "d", blob: jpeg(2), createdAt: 5 });
    const now = OUTBOX_TTL_MS + 1;
    expect((await listShots("f", now)).map((s) => s.id)).toEqual(["new"]);
    // And it is gone from disk, not just filtered from this answer.
    expect((await listShots("f", 0)).map((s) => s.id)).toEqual(["new"]);
  });

  test("no IndexedDB at all degrades quietly", async () => {
    g.indexedDB = undefined;
    _resetOutboxForTests();
    expect(await putShot({ id: "x", token: "f", deviceId: "d", blob: jpeg(1), createdAt: 1 })).toBe(
      false,
    );
    expect(await listShots("f")).toEqual([]);
    await deleteShot("x");
  });
});
