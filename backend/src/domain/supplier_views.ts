// Directory visit analytics. Records public-side card views + outbound clicks
// keyed by the public supplier id (curated slug or "c{N}"). The admin
// directory view aggregates total / 30-day / 7-day windows; we don't bother
// with finer buckets until the metric matters.

import {
  type AdminDirectoryFacets,
  type AdminDirectoryFilters,
  DIRECTORY_GAPS,
  type DirectoryGap,
  type SupplierAnalytics,
  type SupplierCategory,
  type SupplierDirectoryAdminRow,
  type SupplierEventInput,
  type SupplierEventType,
} from "@shared/suppliers";
import { db, now } from "../db";
import {
  type CommunitySupplierRowWithEmail,
  listAllForAdmin,
  toDirectorySupplierBase,
} from "./community_suppliers";
import { curatedOverrideMap } from "./curated_overrides";
import { DIRECTORY } from "./suppliers_data";

const VALID_EVENT_TYPES: ReadonlySet<SupplierEventType> = new Set([
  "view",
  "impression",
  "website_click",
  "phone_click",
]);

/** Insert a batch of events. Silently drops entries with an unknown supplier
 *  id or event type so a malformed client payload can't poison the table.
 *  Returns the number of rows persisted. */
export function recordSupplierEvents(
  events: SupplierEventInput[],
  userId: number | null,
  coupleId: number | null,
): number {
  if (events.length === 0) return 0;

  const validIds = knownSupplierIds();
  // A vendor checking their own page is not reach. The listing editor and the
  // reviews page both link to the live `/vendors/:id`, and that page counts a
  // view like any other, so a vendor who previews their profile a few times a
  // week watches "Megtekintés (30 nap)" climb on nobody but themselves.
  const ownIds = userId === null ? EMPTY_IDS : listingIdsOwnedBy(userId);
  const ts = now();
  const insert = db.prepare(
    `INSERT INTO supplier_events (supplier_id, event_type, user_id, couple_id, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  let written = 0;
  const tx = db.transaction((rows: SupplierEventInput[]) => {
    for (const e of rows) {
      if (!e || typeof e.supplier_id !== "string" || typeof e.type !== "string") continue;
      if (!VALID_EVENT_TYPES.has(e.type)) continue;
      if (!validIds.has(e.supplier_id)) continue;
      if (ownIds.has(e.supplier_id)) continue;
      insert.run(e.supplier_id, e.type, userId, coupleId, ts);
      written++;
    }
  });
  tx(events);
  return written;
}

const EMPTY_IDS: ReadonlySet<string> = new Set();

/** Public ids of every listing this user owns through their vendor account.
 *  Empty for anonymous visitors and for couples, which is the common case and
 *  costs one indexed lookup that misses. A vendor can own several listings
 *  (their own `v{N}` card plus anything they have claimed), so this is a set
 *  rather than a single id. */
function listingIdsOwnedBy(userId: number): ReadonlySet<string> {
  const rows = db
    .prepare(
      `SELECT l.id
         FROM listings l
         JOIN vendor_accounts va ON va.id = l.vendor_account_id
        WHERE va.owner_user_id = ?`,
    )
    .all(userId) as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

/** Returns the set of public supplier ids the directory currently exposes —
 *  every curated slug + the id ("c{N}") of every community supplier the DB
 *  knows about (any status; an admin-hidden row still gets to keep its
 *  history). Recomputed per call; the admin list is small enough that we
 *  don't bother caching. */
function knownSupplierIds(): Set<string> {
  const ids = new Set<string>(DIRECTORY.map((s) => s.id));
  const rows = db.prepare("SELECT id FROM community_suppliers").all() as { id: number }[];
  for (const r of rows) ids.add(`c${r.id}`);
  // Every row in the unified `listings` table is a real, directory-exposable id
  // — including self-registered vendors' `v{N}` cards, which are covered by
  // neither DIRECTORY nor community_suppliers. Without this, vendor views/clicks
  // were silently dropped (their supplier_id never matched the whitelist).
  const listingRows = db.prepare("SELECT id FROM listings").all() as { id: string }[];
  for (const r of listingRows) ids.add(r.id);
  return ids;
}

/** Per-supplier analytics keyed by public supplier id. Three windows
 *  (lifetime, 30d, 7d) plus per-type subtotals + the most recent event
 *  timestamp. One scan over `supplier_events`; safe up to a few hundred
 *  thousand rows on the embedded SQLite. */
export function aggregateAnalytics(): Map<string, SupplierAnalytics> {
  const out = new Map<string, SupplierAnalytics>();
  const ts = now();
  const cut30 = ts - 30 * 24 * 60 * 60 * 1000;
  const cut7 = ts - 7 * 24 * 60 * 60 * 1000;
  const rows = db
    .prepare(
      `SELECT supplier_id, event_type, created_at
         FROM supplier_events`,
    )
    .all() as { supplier_id: string; event_type: string; created_at: number }[];
  for (const r of rows) {
    const a = out.get(r.supplier_id) ?? emptyAnalytics();
    if (r.event_type === "view") {
      a.views_total++;
      if (r.created_at >= cut30) a.views_30d++;
      if (r.created_at >= cut7) a.views_7d++;
    } else if (r.event_type === "impression") {
      a.impressions_total++;
      if (r.created_at >= cut30) a.impressions_30d++;
    } else if (r.event_type === "website_click") {
      a.website_clicks_total++;
      if (r.created_at >= cut30) a.website_clicks_30d++;
    } else if (r.event_type === "phone_click") {
      a.phone_clicks_total++;
    }
    if (a.last_event_at === null || r.created_at > a.last_event_at) {
      a.last_event_at = r.created_at;
    }
    out.set(r.supplier_id, a);
  }
  return out;
}

function emptyAnalytics(): SupplierAnalytics {
  return {
    views_total: 0,
    views_30d: 0,
    views_7d: 0,
    impressions_total: 0,
    impressions_30d: 0,
    website_clicks_total: 0,
    website_clicks_30d: 0,
    phone_clicks_total: 0,
    last_event_at: null,
  };
}

/** Profile-open counts for a specific set of listing ids, in the three windows
 *  the vendor's own stats page quotes. Unlike `aggregateAnalytics`, which scans
 *  the whole table to build the admin directory, this is one indexed lookup per
 *  vendor request (`idx_supplier_events_supplier`): the vendor dashboard is a
 *  hot path and must not pay for everyone else's events.
 *
 *  Deliberately counts `view` only: an `impression` means the vendor's card
 *  scrolled past in a list, which is not "somebody looked at you". */
export function viewCountsForListings(ids: string[]): {
  total: number;
  d30: number;
  d7: number;
} {
  if (ids.length === 0) return { total: 0, d30: 0, d7: 0 };
  const ts = now();
  const placeholders = ids.map(() => "?").join(",");
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END), 0) AS d30,
              COALESCE(SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END), 0) AS d7
         FROM supplier_events
        WHERE event_type = 'view' AND supplier_id IN (${placeholders})`,
    )
    .get(ts - 30 * 24 * 60 * 60 * 1000, ts - 7 * 24 * 60 * 60 * 1000, ...ids) as {
    total: number;
    d30: number;
    d7: number;
  };
  return { total: row.total, d30: row.d30, d7: row.d7 };
}

/** Roll several listings' analytics into one combined block. A vendor account
 *  can own more than one listing (its `v{N}` card plus any curated/community
 *  listing it has claimed), so the admin vendor row shows their summed reach.
 *  Returns an all-zero block when none of the ids have events. */
export function sumAnalytics(
  ids: Iterable<string>,
  perListing: Map<string, SupplierAnalytics>,
): SupplierAnalytics {
  const acc = emptyAnalytics();
  for (const id of ids) {
    const a = perListing.get(id);
    if (!a) continue;
    acc.views_total += a.views_total;
    acc.views_30d += a.views_30d;
    acc.views_7d += a.views_7d;
    acc.impressions_total += a.impressions_total;
    acc.impressions_30d += a.impressions_30d;
    acc.website_clicks_total += a.website_clicks_total;
    acc.website_clicks_30d += a.website_clicks_30d;
    acc.phone_clicks_total += a.phone_clicks_total;
    if (
      a.last_event_at !== null &&
      (acc.last_event_at === null || a.last_event_at > acc.last_event_at)
    ) {
      acc.last_event_at = a.last_event_at;
    }
  }
  return acc;
}

/** Build the full admin directory list: curated entries + every community
 *  row (any status), each annotated with its analytics block. Filters narrow
 *  the row set; analytics counters are NOT re-scoped by the date filter
 *  (those windows are fixed lifetime/30d/7d so the admin always sees them
 *  consistently regardless of the row filter). */
export function listDirectoryForAdmin(filters: AdminDirectoryFilters): SupplierDirectoryAdminRow[] {
  const analytics = aggregateAnalytics();
  const overrides = curatedOverrideMap();
  const rows: SupplierDirectoryAdminRow[] = [];

  // Curated half — code-resident. Status is 'active' unless an admin override
  // hides it; 'deleted' overrides are skipped entirely so the tombstoned entry
  // stays out of the catalog.
  for (const s of DIRECTORY) {
    const ov = overrides.get(s.id);
    if (ov?.status === "deleted") continue;
    rows.push({
      id: s.id,
      community_id: null,
      source: "curated",
      name: s.name,
      category: s.category,
      city: s.city,
      address: s.address,
      website: s.website,
      contact_email: s.contact_email,
      contact_email_flag: s.contact_email_flag ?? null,
      contact_phone: s.contact_phone,
      price_band: s.price_band,
      status: ov?.status === "hidden" ? "hidden" : "active",
      submitter_email: null,
      submitter_type: null,
      submitter_last_seen_at: null,
      created_at: null,
      hero_image_url: null, // overlaid from `listings` below
      analytics: analytics.get(s.id) ?? emptyAnalytics(),
    });
  }

  // Community half — DB rows, every status (admins want to see hidden ones
  // here too so the table doubles as a complete inventory).
  const community: CommunitySupplierRowWithEmail[] = listAllForAdmin();
  for (const c of community) {
    const base = toDirectorySupplierBase(c);
    const publicId = `c${c.id}`;
    rows.push({
      id: publicId,
      community_id: c.id,
      source: "community",
      name: base.name,
      category: base.category,
      city: base.city,
      address: base.address,
      website: base.website,
      // Privacy carve-out: the public DTO suppresses contact_email, but the
      // admin directory deliberately surfaces it — moderators triage with
      // the real address visible.
      contact_email: c.contact_email,
      // A community row is self-published: the submitter typed their own
      // address, so there is no scraped address to hold back.
      contact_email_flag: null,
      contact_phone: base.contact_phone,
      price_band: base.price_band,
      status: (c.status as SupplierDirectoryAdminRow["status"]) ?? "active",
      submitter_email: c.submitter_email,
      submitter_type: base.submitter_type,
      submitter_last_seen_at: c.submitter_last_seen_at,
      created_at: c.created_at,
      hero_image_url: null, // overlaid from `listings` below
      analytics: analytics.get(publicId) ?? emptyAnalytics(),
    });
  }

  // Overlay the current hero from the unified `listings` table (vendor upload or
  // website auto-fill) so the admin table can show which cards have an image.
  // One IN(...) hop, same pattern as the public list in routes/suppliers.ts.
  if (rows.length > 0) {
    const placeholders = rows.map(() => "?").join(",");
    const heroRows = db
      .prepare(`SELECT id, hero_image_url FROM listings WHERE id IN (${placeholders})`)
      .all(...rows.map((r) => r.id)) as Array<{ id: string; hero_image_url: string | null }>;
    const heroById = new Map(heroRows.map((r) => [r.id, r.hero_image_url] as const));
    for (const row of rows) {
      const hero = heroById.get(row.id);
      if (hero !== undefined) row.hero_image_url = hero;
    }
  }

  return rows.filter((row) => matches(row, filters));
}

/** The list plus its gap facet counts, in ONE pass over the catalogue.
 *
 *  The whole directory is assembled in memory anyway (curated entries live in
 *  code, community rows are one query, heroes are one IN(...)), so counting the
 *  four gaps costs a walk over an array we already hold. That is what makes the
 *  chips affordable: they say "412" rather than making an admin apply a filter
 *  to find out it was empty.
 *
 *  Gap counts are measured against `base` (every active filter EXCEPT the gap
 *  toggles), per the rule on `AdminDirectoryFacets`. */
export function listDirectoryWithFacets(filters: AdminDirectoryFilters): {
  rows: SupplierDirectoryAdminRow[];
  facets: AdminDirectoryFacets;
} {
  const base = listDirectoryForAdmin({ ...filters, gaps: undefined, contact: undefined });
  const gaps = Object.fromEntries(DIRECTORY_GAPS.map((g) => [g, 0])) as Record<
    DirectoryGap,
    number
  >;
  for (const row of base) {
    for (const gap of DIRECTORY_GAPS) if (hasGap(row, gap)) gaps[gap] += 1;
  }
  const active = activeGaps(filters);
  const rows =
    active.length === 0 ? base : base.filter((row) => active.every((g) => hasGap(row, g)));
  return { rows, facets: { base_total: base.length, gaps } };
}

/** Is this hole present on this row? One place, so the filter, the facet count
 *  and (via the row DTO) the table's inline warning can never disagree. */
function hasGap(row: SupplierDirectoryAdminRow, gap: DirectoryGap): boolean {
  switch (gap) {
    case "no_email":
      return (row.contact_email ?? "").trim().length === 0;
    case "no_phone":
      return (row.contact_phone ?? "").trim().length === 0;
    case "no_website":
      return (row.website ?? "").trim().length === 0;
    case "no_hero":
      return (row.hero_image_url ?? "").trim().length === 0;
    case "flagged_email":
      return row.contact_email_flag != null;
  }
}

/** Requested gaps, with the legacy `contact=no_email` folded in and duplicates
 *  dropped. The two spellings of the same filter must not narrow twice. */
function activeGaps(f: AdminDirectoryFilters): DirectoryGap[] {
  const set = new Set<DirectoryGap>(f.gaps ?? []);
  if (f.contact === "no_email") set.add("no_email");
  return [...set];
}

function matches(row: SupplierDirectoryAdminRow, f: AdminDirectoryFilters): boolean {
  if (f.source && f.source !== "all" && row.source !== f.source) return false;
  for (const gap of activeGaps(f)) if (!hasGap(row, gap)) return false;
  if (f.status && f.status !== "all" && row.status !== f.status) return false;
  if (f.category && f.category !== "all" && row.category !== f.category) return false;
  if (f.city && f.city.trim().length > 0) {
    if (!row.city.toLowerCase().includes(f.city.trim().toLowerCase())) return false;
  }
  if (f.q && f.q.trim().length > 0) {
    const needle = f.q.trim().toLowerCase();
    const hay = `${row.name} ${row.city} ${row.website}`.toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  if (typeof f.min_views === "number" && f.min_views > 0) {
    if (row.analytics.views_total < f.min_views) return false;
  }
  // Date window applies to `created_at` for community rows. Curated rows have
  // no submission date; we exclude them when a date window is set so the
  // filter behaves as advertised ("submissions in this period").
  const hasFrom = typeof f.from === "number" && f.from !== null;
  const hasTo = typeof f.to === "number" && f.to !== null;
  if (hasFrom || hasTo) {
    if (row.created_at === null) return false;
    if (hasFrom && row.created_at < (f.from as number)) return false;
    if (hasTo && row.created_at > (f.to as number)) return false;
  }
  return true;
}

/** Parses + clamps the filter querystring shared between the JSON list + the
 *  CSV export endpoints. Unknown values fall back to "all"; numeric fields
 *  are coerced to finite ints or dropped. */
export function parseDirectoryFilters(params: URLSearchParams): AdminDirectoryFilters {
  const out: AdminDirectoryFilters = {};
  const source = params.get("source");
  if (source === "curated" || source === "community" || source === "all") out.source = source;
  const contact = params.get("contact");
  if (contact === "no_email" || contact === "all") out.contact = contact;
  // `gaps=no_email,no_hero`. Unknown names are dropped rather than 400'ing: this
  // is a filter, and an admin who follows a stale link should get a list they
  // can fix by hand, not an error page.
  const gaps = params.get("gaps");
  if (gaps) {
    const wanted = gaps
      .split(",")
      .map((g) => g.trim())
      .filter((g): g is DirectoryGap => (DIRECTORY_GAPS as readonly string[]).includes(g));
    if (wanted.length > 0) out.gaps = [...new Set(wanted)];
  }
  const status = params.get("status");
  if (
    status === "active" ||
    status === "pending" ||
    status === "awaiting_review" ||
    status === "hidden" ||
    status === "all"
  ) {
    out.status = status;
  }
  const category = params.get("category");
  if (category) out.category = category as SupplierCategory | "all";
  const city = params.get("city");
  if (city) out.city = city;
  const q = params.get("q");
  if (q) out.q = q;
  const minViews = params.get("min_views");
  if (minViews !== null) {
    const n = Number(minViews);
    if (Number.isFinite(n) && n >= 0) out.min_views = Math.floor(n);
  }
  const from = params.get("from");
  if (from !== null) {
    const n = Number(from);
    if (Number.isFinite(n) && n > 0) out.from = n;
  }
  const to = params.get("to");
  if (to !== null) {
    const n = Number(to);
    if (Number.isFinite(n) && n > 0) out.to = n;
  }
  return out;
}
