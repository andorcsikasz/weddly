import "../setup";

import { describe, expect, test } from "bun:test";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { maybeCompress, negotiateEncoding } from "../../src/lib/compression";

const BASE = `http://localhost:${process.env.PORT ?? "8791"}`;

// A compressible body comfortably over the 1KB threshold.
const BIG_TEXT = `<root>${"weddly seo compression test ".repeat(200)}</root>`;

function makeReq(acceptEncoding: string | null): Request {
  const headers = new Headers();
  if (acceptEncoding !== null) headers.set("accept-encoding", acceptEncoding);
  return new Request("http://localhost/x", { headers });
}

function makeRes(body: string, contentType = "text/html; charset=utf-8"): Response {
  return new Response(body, { headers: { "Content-Type": contentType } });
}

describe("negotiateEncoding", () => {
  test("prefers brotli when both offered", () => {
    expect(negotiateEncoding("gzip, deflate, br")).toBe("br");
  });
  test("falls back to gzip", () => {
    expect(negotiateEncoding("gzip, deflate")).toBe("gzip");
  });
  test("null when client accepts neither", () => {
    expect(negotiateEncoding("deflate")).toBeNull();
    expect(negotiateEncoding(null)).toBeNull();
  });
  test("does not match 'br' inside a larger token", () => {
    // "brunost" must not be read as brotli.
    expect(negotiateEncoding("brunost")).toBeNull();
  });
});

describe("maybeCompress — unit", () => {
  test("brotli-compresses a large HTML body and round-trips", async () => {
    const out = await maybeCompress(makeReq("br"), makeRes(BIG_TEXT));
    expect(out.headers.get("Content-Encoding")).toBe("br");
    expect(out.headers.get("Vary")).toContain("Accept-Encoding");
    const decoded = brotliDecompressSync(Buffer.from(await out.arrayBuffer())).toString();
    expect(decoded).toBe(BIG_TEXT);
  });

  test("gzip-compresses when brotli is not offered", async () => {
    const out = await maybeCompress(makeReq("gzip"), makeRes(BIG_TEXT));
    expect(out.headers.get("Content-Encoding")).toBe("gzip");
    const decoded = gunzipSync(Buffer.from(await out.arrayBuffer())).toString();
    expect(decoded).toBe(BIG_TEXT);
  });

  test("leaves the body untouched when client accepts no encoding", async () => {
    const out = await maybeCompress(makeReq(null), makeRes(BIG_TEXT));
    expect(out.headers.get("Content-Encoding")).toBeNull();
    expect(await out.text()).toBe(BIG_TEXT);
  });

  test("skips non-compressible content types (images)", async () => {
    const res = new Response(new Uint8Array(4096), { headers: { "Content-Type": "image/png" } });
    const out = await maybeCompress(makeReq("br"), res);
    expect(out.headers.get("Content-Encoding")).toBeNull();
  });

  test("skips bodies under the 1KB threshold", async () => {
    const out = await maybeCompress(makeReq("br"), makeRes("tiny"));
    expect(out.headers.get("Content-Encoding")).toBeNull();
    expect(await out.text()).toBe("tiny");
  });

  test("does not double-compress an already-encoded response", async () => {
    const res = new Response("already", {
      headers: { "Content-Type": "text/html", "Content-Encoding": "br" },
    });
    const out = await maybeCompress(makeReq("br"), res);
    // Same object back, untouched.
    expect(out.headers.get("Content-Encoding")).toBe("br");
    expect(await out.text()).toBe("already");
  });
});

describe("compression — integration against the live sitemap", () => {
  test("Accept-Encoding: br returns valid, decompressed XML", async () => {
    // Bun's fetch transparently decompresses, so a corrupt/garbled encoding
    // would surface as broken XML here. This proves the wire path round-trips.
    const res = await fetch(`${BASE}/sitemap.xml`, { headers: { "accept-encoding": "br" } });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<urlset");
    expect(body).toContain("https://weddly.hu/");
  });
});
