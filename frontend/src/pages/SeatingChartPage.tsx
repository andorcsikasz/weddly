// SEO tool: /eszkozok/ultetesi-rend-keszito — landing page for the
// /app/seating canvas, with the SEO content the in-app experience can't
// host (etiquette tips, print sizes, FAQ). Targets "ültetési rend program",
// "ültetési rend készítő ingyen", "wedding seating chart maker" and similar.
//
// No standalone drag-and-drop canvas here — the real one lives at
// /app/seating and requires auth + a workspace to populate. The "how many
// tables" planner below is a lighter, purely client-side calculator: it
// answers the question a lot of these searches are actually asking ("how
// many round tables of 8 for 120 guests?") without needing a guest list at
// all, then the page sells the full canvas and links to signup.

import { useState } from "react";
import { Link } from "react-router-dom";
import { TOOL_FAQ } from "@shared/tool_faq";
import { SeatingMockup } from "../components/mockups";
import { PublicShell } from "../components/PublicShell";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

type TableSize = "round8" | "round10" | "rect10" | "banquet12";

const TABLE_SEATS: Record<TableSize, number> = {
  round8: 8,
  round10: 10,
  rect10: 10,
  banquet12: 12,
};
const TABLE_SHAPE: Record<TableSize, "round" | "rect"> = {
  round8: "round",
  round10: "round",
  rect10: "rect",
  banquet12: "rect",
};
const TABLE_SIZES: TableSize[] = ["round8", "round10", "rect10", "banquet12"];

const MIN_GUESTS = 10;
const MAX_GUESTS = 300;
const DEFAULT_GUESTS = 100;
// Beyond this many icons a grid stops reading as "count at a glance" and
// starts costing render time for no benefit — the stat tile already carries
// the exact number.
const MAX_GRID_ICONS = 60;

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

export default function SeatingChartPage() {
  const { t, locale } = useT();
  useDocumentMeta("tools.seating_chart.page_h1", "tools.seating_chart.page_intro");

  const [guests, setGuests] = useState(DEFAULT_GUESTS);
  const [tableSize, setTableSize] = useState<TableSize>("round8");

  const seats = TABLE_SEATS[tableSize];
  const tableCount = Math.max(1, Math.ceil(guests / seats));
  const totalSeats = tableCount * seats;
  const spare = totalSeats - guests;
  const visibleTables = Math.min(tableCount, MAX_GRID_ICONS);
  const overflowTables = tableCount - visibleTables;

  return (
    <PublicShell>
      <section className="relative">
        <div className="mx-auto max-w-3xl px-4 pt-12 pb-10 sm:px-6 sm:pt-16 sm:pb-12">
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-blush-600 dark:text-blush-300">
            {t("tools.seating_chart.page_eyebrow")}
          </p>
          <h1 className="mt-4 font-grotesk text-4xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-5xl lg:text-6xl">
            {t("tools.seating_chart.page_h1")}
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-ink-700 dark:text-paper-200">
            {t("tools.seating_chart.page_intro")}
          </p>
        </div>
      </section>

      {/* Mockup band — uses the existing landing SeatingMockup so visitors
          see the actual canvas style before they sign up. */}
      <section className="relative overflow-hidden bg-paper-100 dark:bg-umber-900">
        <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
          <div className="origin-bottom mx-auto max-w-3xl drop-shadow-[0_20px_40px_rgba(16,24,48,0.14)]">
            <SeatingMockup className="h-auto w-full" />
          </div>
        </div>
      </section>

      {/* Table planner — the calculator half of this page. Guests + table
          size drive everything else; there's deliberately no manual
          override of the table count, so dragging the slider always shows
          the honest suggested count rather than fighting a stale one. */}
      <section className="relative">
        <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
          <h2 className="font-grotesk text-3xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-4xl">
            {t("tools.seating_chart.planner_h2")}
          </h2>
          <p className="mt-2 text-sm italic text-ink-500 dark:text-umber-300">
            {t("tools.seating_chart.planner_caption")}
          </p>

          <div className="mt-8 rounded-2xl border border-paper-300 dark:border-umber-700 bg-white dark:bg-umber-800 p-5 shadow-pop sm:p-6">
            <div>
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor="planner-guests"
                  className="font-grotesk text-base text-ink-900 dark:text-paper-50"
                >
                  {t("tools.seating_chart.planner_guests_label")}
                </label>
                <span className="font-grotesk text-lg font-semibold tabular-nums text-blush-600 dark:text-blush-300">
                  {guests}
                </span>
              </div>
              <input
                id="planner-guests"
                type="range"
                min={MIN_GUESTS}
                max={MAX_GUESTS}
                step={1}
                value={guests}
                onChange={(e) => setGuests(clamp(Number(e.target.value), MIN_GUESTS, MAX_GUESTS))}
                className="mt-2 min-h-tap w-full touch-pan-y cursor-pointer rounded accent-blush-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blush-500 sm:min-h-0"
                aria-label={t("tools.seating_chart.planner_guests_label")}
                aria-valuetext={`${guests}`}
              />
            </div>

            <div className="mt-6">
              <p className="font-grotesk text-base text-ink-900 dark:text-paper-50">
                {t("tools.seating_chart.planner_size_label")}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {TABLE_SIZES.map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => setTableSize(size)}
                    className={`rounded-full border px-4 py-2 text-sm transition-colors ${
                      tableSize === size
                        ? "border-ink-700 bg-ink-700 text-paper-50"
                        : "border-paper-300 dark:border-umber-700 text-ink-700 dark:text-paper-200 hover:bg-paper-100 dark:hover:bg-umber-700"
                    }`}
                  >
                    {t(`tools.seating_chart.planner_size_${size}`)}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-6 grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-paper-50 dark:bg-umber-900 px-3 py-3 text-center ring-1 ring-paper-300 dark:ring-umber-700">
                <p className="font-grotesk text-2xl text-ink-900 dark:text-paper-50">
                  {tableCount}
                </p>
                <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-ink-500 dark:text-umber-300">
                  {t("tools.seating_chart.planner_tables_label")}
                </p>
              </div>
              <div className="rounded-xl bg-paper-50 dark:bg-umber-900 px-3 py-3 text-center ring-1 ring-paper-300 dark:ring-umber-700">
                <p className="font-grotesk text-2xl text-ink-900 dark:text-paper-50">
                  {totalSeats}
                </p>
                <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-ink-500 dark:text-umber-300">
                  {t("tools.seating_chart.planner_seats_label")}
                </p>
              </div>
              <div className="rounded-xl bg-paper-50 dark:bg-umber-900 px-3 py-3 text-center ring-1 ring-paper-300 dark:ring-umber-700">
                <p className="font-grotesk text-2xl text-ink-900 dark:text-paper-50">
                  {spare === 0 ? "0" : `+${spare}`}
                </p>
                <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-ink-500 dark:text-umber-300">
                  {spare === 0
                    ? t("tools.seating_chart.planner_spare_none")
                    : t("tools.seating_chart.planner_spare_label")}
                </p>
              </div>
            </div>

            {/* Decorative reinforcement of the "tables needed" number above —
                the stat tile is the accessible source of truth, so this grid
                stays out of the a11y tree rather than reading 60 list items
                aloud. */}
            <div className="mt-6 flex flex-wrap gap-2" aria-hidden="true">
              {Array.from({ length: visibleTables }).map((_, i) => (
                <span
                  key={`${tableSize}-${i}`}
                  title={`${seats}`}
                  className={`flex h-7 items-center justify-center text-[10px] font-semibold text-blush-700 ring-1 ring-blush-300 dark:text-blush-200 dark:ring-blush-500/40 bg-blush-50 dark:bg-blush-900/20 ${
                    TABLE_SHAPE[tableSize] === "round" ? "w-7 rounded-full" : "w-9 rounded-md"
                  }`}
                >
                  {seats}
                </span>
              ))}
              {overflowTables > 0 && (
                <span className="flex h-7 items-center px-2 text-[11px] font-medium text-ink-500 dark:text-umber-300">
                  {t("tools.seating_chart.planner_grid_more").replace(
                    "{n}",
                    String(overflowTables),
                  )}
                </span>
              )}
            </div>
          </div>

          <p className="mt-4 text-sm leading-relaxed text-ink-600 dark:text-umber-300">
            {t("tools.seating_chart.planner_note")}
          </p>
        </div>
      </section>

      <section className="relative">
        <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
          <h2 className="font-grotesk text-3xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-4xl">
            {t("tools.seating_chart.what_h2")}
          </h2>
          <p className="mt-6 text-base leading-relaxed text-ink-700 dark:text-paper-200">
            {t("tools.seating_chart.what_body")}
          </p>
        </div>
      </section>

      <section className="relative stationery-light">
        <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
          <h2 className="font-grotesk text-3xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-4xl">
            {t("tools.seating_chart.print_h2")}
          </h2>
          <p className="mt-6 text-base leading-relaxed text-ink-700 dark:text-paper-200">
            {t("tools.seating_chart.print_body")}
          </p>
          <ul className="mt-6 space-y-4 text-base leading-relaxed text-ink-700 dark:text-paper-200">
            <li>{t("tools.seating_chart.print_li_a4")}</li>
            <li>{t("tools.seating_chart.print_li_a6")}</li>
            <li>{t("tools.seating_chart.print_li_a3")}</li>
          </ul>
        </div>
      </section>

      {/* Etiquette — two-column on larger screens: tips on the left, a real
          place-setting photo on the right so the page isn't wall-to-wall
          text by the time a visitor reaches it. Mobile stacks photo below
          copy, same rule the landing "guests" block follows. */}
      <section className="relative">
        <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6 sm:py-20">
          <div className="grid gap-8 lg:grid-cols-[1fr_0.85fr] lg:items-center lg:gap-12">
            <div>
              <h2 className="font-grotesk text-3xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-4xl">
                {t("tools.seating_chart.etiquette_h2")}
              </h2>
              <ul className="mt-8 space-y-4 text-base leading-relaxed text-ink-700 dark:text-paper-200">
                <li>{t("tools.seating_chart.etiquette_li_1")}</li>
                <li>{t("tools.seating_chart.etiquette_li_2")}</li>
                <li>{t("tools.seating_chart.etiquette_li_3")}</li>
                <li>{t("tools.seating_chart.etiquette_li_4")}</li>
              </ul>
            </div>
            {/* Decorative: the heading and list carry the meaning, so this
                stays out of the accessibility tree. width/height are the
                real pixels so the row reserves its space before the file
                lands. */}
            <img
              src="/design-photos/03-place-setting.jpg"
              alt=""
              aria-hidden="true"
              width={1600}
              height={1067}
              loading="lazy"
              decoding="async"
              className="h-auto w-full rounded-3xl ring-1 ring-paper-300 dark:ring-umber-700"
            />
          </div>
        </div>
      </section>

      <section className="relative stationery-light">
        <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6 sm:py-20">
          <h2 className="font-grotesk text-3xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-4xl">
            {t("tools.seating_chart.cta_h2")}
          </h2>
          <p className="mt-6 text-base leading-relaxed text-ink-700 dark:text-paper-200">
            {t("tools.seating_chart.cta_body")}
          </p>
          <Link to="/signup" className="btn-primary btn-lg mt-8 inline-flex shadow-sm">
            {t("tools.seating_chart.cta_button")}
          </Link>
        </div>
      </section>

      <section className="relative">
        <div className="mx-auto max-w-2xl px-4 py-14 sm:px-6 sm:py-20">
          <h2 className="font-grotesk text-3xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-4xl">
            {t("tools.seating_chart.faq_h2")}
          </h2>
          <div className="mt-8 space-y-3">
            {TOOL_FAQ[locale].seating_chart.map((entry) => (
              <details
                key={entry.q}
                className="group rounded-2xl border border-paper-300 dark:border-umber-700 bg-paper-50 dark:bg-umber-800 px-5 py-4 transition-colors open:bg-white dark:open:bg-umber-700 sm:px-6 sm:py-5"
              >
                <summary className="cursor-pointer list-none font-grotesk text-xl text-ink-900 dark:text-paper-50">
                  {entry.q}
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-ink-600 dark:text-umber-200">
                  {entry.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </PublicShell>
  );
}
