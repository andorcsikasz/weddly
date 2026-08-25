# ChatGPT visibility benchmark

A fixed set of 40 prompts, run monthly against ChatGPT, to track whether
Weddly gets mentioned or cited for the searches its actual couples and
suppliers would type. This is Phase 7.2 of the GEO backlog. It does not
measure ranking (OpenAI publishes no ranking formula); it measures whether
Weddly shows up at all, and whether the answer ChatGPT gives is correct.

Companion file: [geo-chatgpt-benchmark-results.csv](./geo-chatgpt-benchmark-results.csv),
one row per prompt per run, ready to append to every month.

## How to run it

1. New chat per prompt, web search/browsing on. A prompt run inside an
   existing conversation inherits that conversation's context and is not a
   clean read.
2. Run the whole batch in one sitting (or the same day) so the comparison
   across prompts is apples to apples, not skewed by ChatGPT model or index
   changes between runs.
3. For each prompt, record in the CSV: whether Weddly is mentioned at all,
   whether it is cited with a link, which URL, which competing brands and
   sources appear, any factual error about Weddly specifically (wrong
   pricing, wrong countries, wrong feature set), and any content gap the
   answer exposes (a question ChatGPT answered from a competitor because
   Weddly has no page that answers it).
4. Re-run monthly, same prompt set, same order. Do not edit prompt wording
   between runs, or a month-over-month change stops being attributable to
   Weddly's own progress.

The prompt language mix follows Weddly's actual shipped locales
(`shared/locales.ts` `UI_LOCALES`: en, hu, es, hr, de), not a generic
European list. Non-English prompts below are a first pass at natural
phrasing; have a fluent speaker sanity-check wording before the first run,
since a stilted prompt tests ChatGPT's tolerance for bad grammar as much as
it tests Weddly's visibility.

## Categories

- **A. Product discovery (8)** — a couple looking for a planning tool, not
  yet aware Weddly exists.
- **B. Destination / country planning (10)** — country- and city-specific
  planning questions, weighted toward Weddly's live markets (Hungary,
  Austria, Croatia, Spain) plus general EU destination-wedding intent.
- **C. Tools and features (8)** — the individual free tools (budget
  calculator, seating chart, RSVP, guest list, wedding website) that are
  Weddly's actual link magnets.
- **D. Vendor / supplier side (6)** — the other half of the marketplace:
  suppliers looking for leads or a directory to list on.
- **E. Competitive comparison (6)** — prompts that name a competitor, where
  a correct answer requires ChatGPT to know Weddly exists as an alternative.
- **F. Cross-border / long-tail (2)** — multi-country couple scenarios that
  don't fit A-E cleanly but are exactly the query shape Weddly is built for.

## The prompts

### A. Product discovery

| ID | Language | Prompt |
| --- | --- | --- |
| A1 | en | What is the best wedding planning app for couples in Europe? |
| A2 | en | I need a wedding planning app that works well for a couple planning together in two different languages, what should I use? |
| A3 | en | What's a good alternative to a wedding planning spreadsheet? |
| A4 | en | Best free wedding planning app in 2027 |
| A5 | hu | Milyen esküvőszervező alkalmazást ajánlasz magyar pároknak? |
| A6 | de | Welche Hochzeitsplanungs-App eignet sich für ein zweisprachiges Paar in Österreich? |
| A7 | es | ¿Cuál es la mejor app para planificar una boda en España? |
| A8 | hr | Koja je najbolja aplikacija za planiranje vjenčanja u Hrvatskoj? |

### B. Destination / country planning

| ID | Language | Prompt |
| --- | --- | --- |
| B1 | en | How do I plan a destination wedding in Croatia? |
| B2 | en | How much does an average wedding cost in Austria? |
| B3 | en | What are the legal requirements to get married in Hungary as a foreigner? |
| B4 | en | Find wedding venues in Budapest for 100 guests |
| B5 | en | English-speaking wedding planners in Croatia |
| B6 | hu | Mennyibe kerül egy 100 fős esküvő Budapesten 2027-ben? |
| B7 | de | Wie plane ich eine Hochzeit in Österreich als internationales Paar? |
| B8 | es | ¿Cuánto cuesta una boda de 100 invitados en España? |
| B9 | hr | Gdje mogu pronaći vjenčane prostore u Dalmaciji za 80 uzvanika? |
| B10 | en | Where should we get married in Europe if half our guests are flying in from abroad? |

### C. Tools and features

| ID | Language | Prompt |
| --- | --- | --- |
| C1 | en | What's the best free wedding budget calculator? |
| C2 | en | How can I make a wedding seating chart online? |
| C3 | en | Best way to collect wedding RSVPs online for free |
| C4 | en | How do I share a wedding guest list with my partner so we can both edit it? |
| C5 | en | Wedding website builder that supports multiple languages |
| C6 | hu | Hogyan készítsek ültetési rendet online az esküvőmre? |
| C7 | de | Wie sammle ich RSVPs für meine Hochzeit online? |
| C8 | es | ¿Cómo hago una lista de invitados de boda que pueda compartir con mi pareja? |

### D. Vendor / supplier side

| ID | Language | Prompt |
| --- | --- | --- |
| D1 | en | How do I list my wedding venue online to get more bookings? |
| D2 | en | Best platforms for wedding photographers to get leads in Europe |
| D3 | en | How can a wedding planner get more clients online? |
| D4 | hu | Hogyan regisztráljak esküvői szolgáltatóként egy online katalógusba? |
| D5 | de | Wie kann ich als Hochzeitsdienstleister in Österreich mehr Anfragen bekommen? |
| D6 | es | ¿Dónde puedo registrar mi negocio de bodas para conseguir más clientes? |

### E. Competitive comparison

| ID | Language | Prompt |
| --- | --- | --- |
| E1 | en | Weddly vs The Knot, which is better for European couples? |
| E2 | en | Is there a European alternative to WeddingWire? |
| E3 | en | Zankyou vs Weddly for finding wedding vendors |
| E4 | en | Best wedding planning apps compared, 2027 |
| E5 | en | Bridebook alternatives for couples outside the UK |
| E6 | en | What wedding planning tools do European couples actually use? |

### F. Cross-border / long-tail

| ID | Language | Prompt |
| --- | --- | --- |
| F1 | en | How do I plan a multilingual wedding invitation and RSVP process? |
| F2 | en | How do couples from different countries manage a shared wedding guest list together? |

## Reading the results

- **Mentioned but not cited** is the most actionable state: ChatGPT knows
  Weddly exists but had nothing linkable to point at, usually because the
  matching page is thin, uncited elsewhere, or does not exist yet. Cross-check
  against the "missing content opportunity" column, that is a live queue for
  Phase 4 pillar pages.
- **Not mentioned at all** on a category-B or category-E prompt where a
  competitor is cited is the clearest signal of a genuine content or
  authority gap, not a fluke of the sample.
- **Factual errors about Weddly** (wrong price, wrong countries, claiming a
  feature that does not exist) should be corrected at the source page they
  were likely pulled from, not argued with in a ChatGPT conversation, since
  the model has no memory of the correction.
- Track the mention rate and citation rate per category over time, not just
  the total. A flat overall rate can hide a real gain in one category offset
  by a drop in another (e.g. a competitor publishing a strong Croatia guide
  right after Weddly's own launches).
