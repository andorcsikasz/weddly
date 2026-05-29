# Weddly off-page / backlink acquisition plan

The May 2026 SEO audit graded **Links: F** (0 backlinks, 0 referring domains).
This is the only HIGH priority item on the board, and on a domain this young
(weddly.hu is days old) off-page authority is the real ceiling: On-Page is
already A+ and the GEO work shipped this session, but none of it ranks without
trust signals, and trust signals are links.

This is the one lever that **cannot be solved in code**. It is outreach with
weeks of lead time, so the value is in starting now and working the list.

Priorities below are ordered by leverage (durable, compounding wins first),
with an EN/international bias because international expansion is the strategic
priority.

---

## 0. The owned asset: free tools as linkbait

Weddly's five working free tools are the single best link magnet it has,
because people link to *useful free things*, not to signup pages. Each already
has its own EN canonical URL (shipped this session):

- `/tools/wedding-budget-calculator`
- `/tools/wedding-countdown`
- `/tools/guest-list-template`
- `/tools/rsvp-text-generator`
- `/tools/100-questions-before-marriage`

These map directly to high-intent EN queries ("how much does a wedding cost",
"wedding guest list template", "questions to ask before marriage") that wedding
blogs and listicles link out to.

**First actions**
1. Treat each tool page as a standalone, shareable EN resource (clear title,
   one-line value prop, an obvious share action).
2. Add an "embed this tool" snippet (an `<iframe>` plus a copy-paste HTML block)
   with an attribution backlink to the canonical tool URL. An embedded widget
   on someone else's wedding blog is a dofollow link that compounds.
3. Once `/tools/*` bodies are fully baked into SSR (deferred backend work, see
   `seo-followups.md`), pitch the tools to roundups as "free, no-signup" tools.

---

## 1. Week 1: zero-friction launch directories (free, EN-first)

Fastest path from 0 to a non-zero referring-domain count.

| Target | Effort | Authority | EN fit | First action |
|--------|--------|-----------|--------|--------------|
| Product Hunt | M (prep assets) | High | Excellent | Draft a launch: tagline, gallery, the free tools as the hook. Schedule a Tuesday/Wednesday launch. |
| BetaList | S | Medium | Excellent | Submit the beta. One paragraph + screenshot. |
| AlternativeTo | S | Medium | Good | List Weddly as an alternative to known wedding planners. |
| SaaSHub | S | Medium | Good | Free listing. |

Product Hunt also drives a burst of real EN visitors, which feeds Plausible and
gives Search Console its first crawl signals.

---

## 2. SaaS + wedding directories (sustained)

| Target | Effort | Authority | Notes |
|--------|--------|-----------|-------|
| G2 | M | High | "Free during open beta" fits. Needs a few reviews to rank in-category. |
| Capterra / GetApp | M | High | Same vendor network as G2. |
| Crozdesk, SoftwareAdvice | S | Medium | Lower effort, incremental. |
| EN wedding-planning portals / blogs | M | Medium-High | Pitch the free tools, not the product. Highest topical relevance. |

Topical relevance matters more than raw authority for a wedding domain: one
link from a wedding-planning site is worth several generic SaaS directory links.

---

## 3. Two-sided vendor backlink loop (durable, compounding)

This is the structurally strongest channel and unique to Weddly's marketplace
shape. Today vendor detail is auth-gated and there is no public, crawlable
vendor profile URL, so the loop does not exist yet.

**What it requires (a real feature, tracked separately):**
1. Public `/vendors/:slug` profile pages with SSR meta + JSON-LD.
2. A "Find us on Weddly" badge/embed each claimed vendor can paste on their own
   site, linking back to their profile.

Every claimed vendor who adds the badge is a fresh referring domain, and the
count grows with the directory. This is the link channel that scales without
per-link outreach. Prioritize building the public profile pages when capacity
allows.

---

## 4. Digital PR and content (slower, higher ceiling)

- **Data angle**: publish an EN "average wedding cost 2026" piece backed by the
  budget calculator's numbers. Cost-of-wedding data gets cited and linked by
  journalists and bloggers.
- **HARO-style sourcing**: respond to wedding/planning queries from reporters
  with a quotable expert take and a link.
- **Guest posts / partnerships**: contribute to EN wedding blogs in exchange for
  an author/resource link.

---

## Measurement

Earned links are invisible without measurement, so this is a prerequisite, not
an afterthought:

- **Google Search Console**: verify weddly.hu and submit the sitemap (see
  `seo-followups.md`). This is how you confirm links are discovered and pages
  indexed.
- **Plausible**: activate `PLAUSIBLE_DOMAIN` (see `seo-followups.md`) to attribute
  referral traffic from each channel and see which directories actually convert.

Re-run the third-party audit after 4-6 weeks of outreach to track the Links
grade moving off F.

---

## What NOT to do

- No paid link schemes, link farms, or PBNs. Google penalises these and a young
  domain has no buffer to absorb a penalty.
- No mass low-quality directory blasts. A hundred junk citations look spammier
  than ten relevant ones and can suppress the domain.
- Do not gate the free tools behind signup to "capture" link traffic. The
  no-signup utility is exactly what earns the link.
