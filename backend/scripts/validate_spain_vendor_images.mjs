#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const path = resolve(process.argv[2] || "docs/spain-vendor-research-2026-08-19.json");
const audit = JSON.parse(await readFile(path, "utf8"));
const urls = audit.rows.map((row) => ({ id: row.id, url: row.gallery_urls[0] }));
const failures = [];
let cursor = 0;
let checked = 0;

async function check(item) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(item.url, {
        headers: {
          "user-agent": "WeddlyResearchBot/1.0 (+https://tryweddly.com)",
          accept: "image/avif,image/webp,image/png,image/jpeg,image/*",
          range: "bytes=0-1023",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(20_000),
      });
      const contentType = response.headers.get("content-type") || "";
      await response.body?.cancel();
      if (
        response.ok &&
        (contentType.startsWith("image/") || /\.(?:avif|webp|png|jpe?g)(?:\?|$)/i.test(item.url))
      )
        return;
      if (attempt === 3)
        failures.push({ ...item, status: response.status, content_type: contentType });
    } catch (error) {
      if (attempt === 3) failures.push({ ...item, error: String(error) });
    }
  }
}

const workers = Array.from({ length: 12 }, async () => {
  while (cursor < urls.length) {
    const item = urls[cursor];
    cursor += 1;
    await check(item);
    checked += 1;
    if (checked % 250 === 0 || checked === urls.length)
      process.stderr.write(`images: ${checked}/${urls.length}; failures: ${failures.length}\n`);
  }
});
await Promise.all(workers);

console.log(JSON.stringify({ checked, valid: checked - failures.length, failures }, null, 2));
if (failures.length) process.exit(1);
