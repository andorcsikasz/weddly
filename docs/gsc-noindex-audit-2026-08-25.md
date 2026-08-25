# Google Search Console noindex audit — 2026-08-25

Source: `tryweddly.com-Coverage-Drilldown-2026-08-25.zip`, Search Console reason
“Excluded by ‘noindex’ tag”. The export contains 231 URLs last crawled between
2026-08-15 and 2026-08-22.

## Classification

| URL group | Count | Decision |
| --- | ---: | --- |
| Legacy `/vendors/<id>` profiles | 108 | Permanent redirect to `/suppliers/<id>`; redirects must not carry robots directives. |
| Current `/suppliers/<id>` profiles | 108 | Index only after the shared 3 meaningful sentences + 3 distinct photos quality gate. |
| `?h=1` cache-buster URLs | 8 | Permanent server redirect to the same URL without `h`; preserve any other query parameters. |
| Tool deck state (`?deck=...`) | 2 | Intentionally `noindex,follow`; canonical tool page remains indexable. |
| Login, signup, forgot-password and RSVP URLs | 5 | Intentionally `noindex`; these are utility/private surfaces. |

After normalising `/vendors` and `/suppliers`, the export represents 111 distinct
profile IDs. Of those, 109 still resolve in the current catalogue and two old
database-backed profiles (`zsuzsi-ceremoniamester-c8`, `fulop-ekszer-v66`) no
longer resolve. Unknown profiles return 404 rather than an indexable SPA shell.

## Profiles improved in this pass

All nine now pass the shared indexability check and appear in the generated
sitemap. Images were opened and dimension-checked before inclusion; all gallery
URLs come from the business's own official website or official hotel CDN.
Short three-sentence descriptions were expanded to four or five useful,
source-backed sentences wherever the official site supplied enough detail.

| Profile | Improvement | Primary source |
| --- | --- | --- |
| Casa dos Penedos | Expanded to three factual sentences; retained five official images. | https://www.penhalongacatering.com/en/portfolio/casa-dos-penedos/ |
| Hotel Bellevue Dubrovnik | Expanded to three factual sentences; retained five official images. | https://www.adriaticluxuryhotels.com/hotel-bellevue-dubrovnik/ |
| The Westin Zagreb | Added three official wedding/event-space images. | https://www.marriott.com/en-us/hotels/zagwi-the-westin-zagreb/overview/ |
| Laganini Beach Club Čiovo | Added six full-resolution images from its official wedding/events page. | https://www.laganinibeachclub.com/blank |
| Hotel Ossowski | Added six official wedding-gallery images. | https://www.hotel-ossowski.com.pl/przyjecia/wesela/ |
| Weigert Images | Added three official wedding portfolio images. | https://www.weigertimages.com/ |
| Dwór Rybieniec | Added five official wedding and venue images. | https://www.dworwrybiencu.pl/en/weddings/ |
| Restauracja Trzy Korony | Added six official venue-gallery images. | http://www.restauracjatrzykorony.pl/galeria |
| Dolce Mondo | Expanded the profile to five useful sentences and added six official wedding-cake/dessert-table images. | https://dolcemondo.hr/svadbene-torte/ |

Before enrichment, none of the 109 resolved profiles in this GSC export passed
the new quality gate. After enrichment, nine pass and 100 remain intentionally
`noindex`. Ten of those are unclaimed imported profiles whose bio/gallery must
stay redacted until the vendor accepts the profile.

## Next enrichment queue

These five already have substantial descriptions and need only a verified 3–7
image gallery: Gałązka Lawendy, Sala w Zieleniewie, Makarska Weddings / Photo
Brzica, I Gemelli and Robert Petrović. Makarska Weddings now has a five-sentence
official-source description and its canonical website, but the domain did not
resolve during the image audit, so its cached portfolio URLs were not promoted.
These profiles should remain `noindex` until official or
vendor-authorised images are available; third-party directory and social-media
images are not a substitute.

After deployment, submit the regenerated sitemap and start Search Console's
“Validate fix” flow. The 108 legacy URLs and eight `h=1` variants should migrate
to the redirect category after Google recrawls them; intentionally private,
stateful and thin URLs should remain excluded.
