import "../setup";

import { describe, expect, test } from "bun:test";
import { db } from "../../src/db";
import { purgeOneUser } from "../../src/domain/purge";
import { req, wipeAll } from "../helpers";

// Signup acquisition capture: country (server-side, IP → ISO, IP discarded),
// device_type (server-side, from UA), and utm_* (client-threaded, coerced).
//
// IMPORTANT: in the test env there is NO GeoLite2 DB (setup.ts pins
// MAXMIND_LICENSE_KEY="" and GEOIP_DB_PATH to a guaranteed-absent file), so the
// country reader is always null. We assert the null-degrade CONTRACT (country
// null + register still 201), never a specific ISO code — a code assertion
// would pass on a dev box with the mmdb and fail in CI without it.

interface AcqRow {
  signup_country: string | null;
  device_type: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
}

function acqRow(email: string): AcqRow {
  return db
    .prepare(
      `SELECT signup_country, device_type, utm_source, utm_medium, utm_campaign, utm_content, utm_term
         FROM users WHERE email = ?`,
    )
    .get(email) as AcqRow;
}

describe("signup acquisition — country (null-degrade)", () => {
  test("register still 201s and stores null country when no GeoLite2 DB is present", async () => {
    wipeAll();
    const r = await req(
      "POST",
      "/api/auth/register",
      { email: "geo@example.com", password: "supersafe123", full_name: "Geo" },
      { clientIp: "8.8.8.8" },
    );
    expect(r.status).toBe(201);
    expect(acqRow("geo@example.com").signup_country).toBeNull();
  });
});

describe("signup acquisition — UTM passthrough", () => {
  test("stores the canonical utm fields from the register body", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/register", {
      email: "utm@example.com",
      password: "supersafe123",
      full_name: "Utm",
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "spring-sale",
      utm_content: "hero-cta",
      utm_term: "wedding planner",
    });
    expect(r.status).toBe(201);
    const row = acqRow("utm@example.com");
    expect(row.utm_source).toBe("google");
    expect(row.utm_medium).toBe("cpc");
    expect(row.utm_campaign).toBe("spring-sale");
    expect(row.utm_content).toBe("hero-cta");
    expect(row.utm_term).toBe("wedding planner");
  });

  test("trims, length-caps oversized values, and nulls non-string junk", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/register", {
      email: "utm2@example.com",
      password: "supersafe123",
      full_name: "Utm2",
      utm_source: "  newsletter  ",
      utm_campaign: "x".repeat(300),
      utm_medium: 42, // deliberately wrong type — must coerce to null at the boundary
      utm_term: "   ",
    });
    expect(r.status).toBe(201);
    const row = acqRow("utm2@example.com");
    expect(row.utm_source).toBe("newsletter"); // trimmed
    expect(row.utm_campaign?.length).toBe(200); // capped
    expect(row.utm_medium).toBeNull(); // number → null
    expect(row.utm_term).toBeNull(); // blank-after-trim → null
  });

  test("bare register (no utm) stores all-null utm and still 201s", async () => {
    wipeAll();
    const r = await req("POST", "/api/auth/register", {
      email: "bare@example.com",
      password: "supersafe123",
      full_name: "Bare",
    });
    expect(r.status).toBe(201);
    const row = acqRow("bare@example.com");
    expect(row.utm_source).toBeNull();
    expect(row.utm_medium).toBeNull();
    expect(row.utm_campaign).toBeNull();
    expect(row.utm_content).toBeNull();
    expect(row.utm_term).toBeNull();
  });
});

describe("signup acquisition — device_type from User-Agent", () => {
  const cases: Array<{ name: string; ua: string | null; expected: string | null }> = [
    {
      name: "iPhone → mobile",
      ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Mobile/15E148",
      expected: "mobile",
    },
    {
      name: "iPad → tablet",
      ua: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605 Mobile/15E148",
      expected: "tablet",
    },
    {
      name: "desktop Chrome → desktop",
      ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537 Chrome/120 Safari/537",
      expected: "desktop",
    },
  ];

  for (const c of cases) {
    test(c.name, async () => {
      wipeAll();
      const email = `dev-${c.expected}@example.com`;
      const r = await req(
        "POST",
        "/api/auth/register",
        { email, password: "supersafe123", full_name: "Dev" },
        c.ua ? { headers: { "user-agent": c.ua } } : {},
      );
      expect(r.status).toBe(201);
      expect(acqRow(email).device_type).toBe(c.expected);
    });
  }
});

describe("signup acquisition — GDPR purge", () => {
  test("purgeOneUser nulls every acquisition field", async () => {
    wipeAll();
    const r = await req<{ user: { id: number } }>("POST", "/api/auth/register", {
      email: "purge-acq@example.com",
      password: "supersafe123",
      full_name: "Purge",
      utm_source: "facebook",
      utm_campaign: "summer",
    });
    expect(r.status).toBe(201);
    const before = acqRow("purge-acq@example.com");
    expect(before.utm_source).toBe("facebook");

    purgeOneUser(r.data.user.id, { adminInitiated: true });

    // Email is rewritten on purge, so read back by id.
    const after = db
      .prepare(
        `SELECT signup_country, device_type, utm_source, utm_medium, utm_campaign, utm_content, utm_term
           FROM users WHERE id = ?`,
      )
      .get(r.data.user.id) as AcqRow;
    expect(after.utm_source).toBeNull();
    expect(after.utm_campaign).toBeNull();
    expect(after.device_type).toBeNull();
    expect(after.signup_country).toBeNull();
  });
});
