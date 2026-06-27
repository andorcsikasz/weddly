import "../setup";

import { describe, expect, test } from "bun:test";
import { keyFromUploadUrl, storage } from "../../src/lib/storage";

// These exercise the DEFAULT (disk) backend — R2 is pinned off in setup.ts.
// They lock the key-normalisation guard and the write/serve/delete/purge
// round-trip that every upload route now depends on.

describe("keyFromUploadUrl", () => {
  test("strips the /uploads/ prefix and the ?v= cache-bust query", () => {
    expect(keyFromUploadUrl("/uploads/blog/12.jpg?v=1700000000")).toBe("blog/12.jpg");
    expect(keyFromUploadUrl("/uploads/couples/3/cover.webp")).toBe("couples/3/cover.webp");
  });

  test("accepts a bare relative path (vendor_waitlist stores keys without the prefix)", () => {
    expect(keyFromUploadUrl("vendor_waitlist/7/price_list.pdf")).toBe(
      "vendor_waitlist/7/price_list.pdf",
    );
  });

  test("rejects traversal and absolute escapes", () => {
    expect(keyFromUploadUrl("/uploads/../../etc/passwd")).toBeNull();
    expect(keyFromUploadUrl("/uploads//etc/passwd")).toBeNull();
    expect(keyFromUploadUrl("")).toBeNull();
  });
});

describe("storage (disk backend)", () => {
  test("write → exists → serve → delete round-trip", async () => {
    const key = "couples/999999/photos/1/1.png";
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

    expect(await storage.exists(key)).toBe(false);
    expect(await storage.serve(key)).toBeNull();

    await storage.write(key, bytes, "image/png");
    expect(await storage.exists(key)).toBe(true);

    const res = await storage.serve(key);
    expect(res).not.toBeNull();
    expect(res?.headers.get("Cache-Control")).toContain("max-age=");
    const served = new Uint8Array(await res!.arrayBuffer());
    expect(served).toEqual(bytes);

    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
  });

  test("deletePrefix removes the whole couple subtree (purge path)", async () => {
    const coupleId = 999998;
    const a = `couples/${coupleId}/photos/1/1.png`;
    const b = `couples/${coupleId}/moodboard/2.webp`;
    await storage.write(a, new Uint8Array([1]));
    await storage.write(b, new Uint8Array([2]));
    expect(await storage.exists(a)).toBe(true);
    expect(await storage.exists(b)).toBe(true);

    await storage.deletePrefix(`couples/${coupleId}/`);
    expect(await storage.exists(a)).toBe(false);
    expect(await storage.exists(b)).toBe(false);
  });

  test("refuses to write an unsafe key", async () => {
    await expect(storage.write("../escape.txt", new Uint8Array([0]))).rejects.toThrow();
  });

  test("delete + serve of a missing key are safe no-ops", async () => {
    await storage.delete("couples/123/does-not-exist.png");
    expect(await storage.serve("couples/123/does-not-exist.png")).toBeNull();
  });
});
