// SEO tool: /{lang}/tools/seating-chart-builder. Landing page for the
// /app/seating canvas, with the SEO content the in-app experience can't host
// (etiquette tips, print sizes, FAQ). Targets "ültetési rend program",
// "ültetési rend készítő ingyen", "wedding seating chart maker" and similar.
//
// The interactive part is a three-step planner: headcount, table type, then
// the room drawn top-down with every table and chair numbered. It answers
// the question most of these searches are really asking ("how many round
// tables of 8 for 120 guests, and what does that look like?") without a
// guest list, then sells the full canvas. Geometry lives in
// lib/seating_room.ts.

import { TOOL_FAQ } from "@shared/tool_faq";
import { ChevronDown, Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { PublicShell } from "../components/PublicShell";
import { useT } from "../lib/i18n";
import {
  CHAIR_R,
  chairOffsets,
  cellSize,
  planRoom,
  TABLE_KINDS,
  TABLE_SPECS,
  type TableKind,
  type TableSpec,
  tableCountFor,
} from "../lib/seating_room";
import { useDocumentMeta } from "../lib/seo";

const MIN_GUESTS = 10;
const MAX_GUESTS = 300;
const DEFAULT_GUESTS = 100;
/** Smallest on-screen scale a table cell may be drawn at before the plan
 *  drops a column; below it the chair numbers stop being readable. */
const MIN_SCALE = 0.62;

const H2 =
  "font-grotesk text-3xl font-bold leading-tight tracking-[-0.02em] text-ink-950 dark:text-paper-50 sm:text-4xl";

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function TableShape({ spec, cx, cy }: { spec: TableSpec; cx: number; cy: number }) {
  const cls = "fill-white stroke-ink-950 dark:fill-umber-800 dark:stroke-paper-100";
  if (spec.shape === "round") {
    return <circle cx={cx} cy={cy} r={spec.radius} strokeWidth={3} className={cls} />;
  }
  return (
    <rect
      x={cx - spec.width / 2}
      y={cy - spec.height / 2}
      width={spec.width}
      height={spec.height}
      rx={10}
      strokeWidth={3}
      className={cls}
    />
  );
}

/** One table with its chairs, no numbers: the step-two picker's picture. */
function TablePictogram({ kind }: { kind: TableKind }) {
  const spec = TABLE_SPECS[kind];
  const cell = cellSize(spec);
  const w = cell.w - 50;
  const h = cell.h - 50;
  return (
    <svg viewBox={`${-w / 2} ${-h / 2} ${w} ${h}`} className="h-24 w-full" aria-hidden>
      {chairOffsets(spec).map((c) => (
        <circle
          key={`${c.x}:${c.y}`}
          cx={c.x}
          cy={c.y}
          r={CHAIR_R}
          className="fill-ink-950 dark:fill-paper-100"
        />
      ))}
      <TableShape spec={spec} cx={0} cy={0} />
    </svg>
  );
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function RoomPlan({ guests, kind }: { guests: number; kind: TableKind }) {
  const { t } = useT();
  const [ref, width] = useWidth<HTMLDivElement>();
  const cell = cellSize(TABLE_SPECS[kind]);
  const columns = Math.max(2, Math.floor((width || 900) / (cell.w * MIN_SCALE)));
  const plan = planRoom(guests, kind, columns);
  const f = plan.danceFloor;

  return (
    <div ref={ref}>
      <svg
        viewBox={`0 0 ${plan.width} ${plan.height}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${t("tools.seating_chart.planner_tables_label")}: ${plan.tableCount}`}
      >
        <rect
          width={plan.width}
          height={plan.height}
          rx={28}
          className="fill-paper-50 dark:fill-umber-900"
        />
        <rect
          x={f.x}
          y={f.y}
          width={f.width}
          height={f.height}
          rx={16}
          className="fill-paper-200 dark:fill-umber-800"
        />
        <text
          x={f.x + f.width / 2}
          y={f.y + f.height / 2}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-ink-600 font-sans text-[26px] font-semibold tracking-[0.12em] uppercase dark:fill-paper-300"
        >
          {t("tools.seating_chart.room_dance_floor")}
        </text>

        {plan.tables.map((table) => (
          <g key={table.number}>
            <title>
              {`${t("tools.seating_chart.room_table", { n: table.number })} · ${t(
                "tools.seating_chart.room_guests_at",
                { n: table.guests },
              )}`}
            </title>
            {table.chairs.map((chair) => (
              <g key={chair.number}>
                <circle
                  cx={chair.x}
                  cy={chair.y}
                  r={CHAIR_R}
                  strokeWidth={2}
                  strokeDasharray={chair.taken ? undefined : "4 4"}
                  className={
                    chair.taken
                      ? "fill-ink-950 stroke-ink-950 dark:fill-paper-100 dark:stroke-paper-100"
                      : "fill-white stroke-ink-300 dark:fill-umber-900 dark:stroke-umber-500"
                  }
                />
                <text
                  x={chair.x}
                  y={chair.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className={`font-sans text-[19px] font-semibold tabular-nums ${
                    chair.taken
                      ? "fill-white dark:fill-ink-950"
                      : "fill-ink-400 dark:fill-umber-400"
                  }`}
                >
                  {chair.number}
                </text>
              </g>
            ))}
            <TableShape spec={table.spec} cx={table.cx} cy={table.cy} />
            <text
              x={table.cx}
              y={table.cy - 6}
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-ink-950 font-sans text-[40px] font-bold tabular-nums dark:fill-paper-50"
            >
              {table.number}
            </text>
            <text
              x={table.cx}
              y={table.cy + 26}
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-ink-500 font-sans text-[16px] font-medium tabular-nums dark:fill-paper-300"
            >
              {`${table.guests}/${table.spec.seats}`}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div>
      <p className="font-grotesk text-3xl font-bold tabular-nums tracking-[-0.02em] text-ink-950 dark:text-paper-50 sm:text-4xl">
        {value}
      </p>
      <p className="mt-1 text-sm text-ink-600 dark:text-paper-300">{label}</p>
    </div>
  );
}

function Planner() {
  const { t } = useT();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [guests, setGuests] = useState(DEFAULT_GUESTS);
  const [kind, setKind] = useState<TableKind>("round8");
  const pct = ((guests - MIN_GUESTS) / (MAX_GUESTS - MIN_GUESTS)) * 100;
  const tableCount = tableCountFor(guests, kind);
  const totalSeats = tableCount * TABLE_SPECS[kind].seats;
  const spare = totalSeats - guests;

  const question =
    step === 1
      ? t("tools.seating_chart.wizard_guests_q")
      : step === 2
        ? t("tools.seating_chart.wizard_size_q")
        : t("tools.seating_chart.wizard_result_q");

  const roundBtn =
    "flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-paper-100 text-ink-950 transition-colors hover:bg-paper-200 disabled:opacity-30 dark:bg-umber-800 dark:text-paper-50 dark:hover:bg-umber-700";
  const pillDark =
    "inline-flex h-12 items-center justify-center rounded-full bg-ink-950 px-6 text-sm font-semibold text-white transition-colors hover:bg-ink-800 dark:bg-paper-50 dark:text-ink-950 dark:hover:bg-paper-200";
  const pillLight =
    "inline-flex h-12 items-center justify-center rounded-full bg-paper-100 px-6 text-sm font-semibold text-ink-950 transition-colors hover:bg-paper-200 dark:bg-umber-800 dark:text-paper-50 dark:hover:bg-umber-700";

  return (
    <div className="rounded-3xl bg-white p-5 shadow-[0_1px_2px_rgba(8,13,28,0.06),0_16px_48px_-16px_rgba(8,13,28,0.2)] ring-1 ring-paper-200 dark:bg-umber-900 dark:ring-umber-800 sm:p-8 lg:p-10">
      <div className="flex items-center gap-4">
        <p className="shrink-0 text-sm font-medium tabular-nums text-ink-600 dark:text-paper-300">
          {t("tools.seating_chart.wizard_step", { n: step })}
        </p>
        <div className="grid flex-1 grid-cols-3 gap-1.5" aria-hidden>
          {[1, 2, 3].map((s) => (
            <span
              key={s}
              className={`h-1 rounded-full ${
                s <= step ? "bg-ink-950 dark:bg-paper-50" : "bg-paper-200 dark:bg-umber-700"
              }`}
            />
          ))}
        </div>
      </div>

      <h3 className="mt-6 font-grotesk text-2xl font-bold tracking-[-0.02em] text-ink-950 dark:text-paper-50 sm:text-3xl">
        {question}
      </h3>

      {step === 1 && (
        <div className="mx-auto mt-10 max-w-xl">
          <div className="flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => setGuests((g) => clamp(g - 1, MIN_GUESTS, MAX_GUESTS))}
              disabled={guests <= MIN_GUESTS}
              aria-label="-1"
              className={roundBtn}
            >
              <Minus aria-hidden strokeWidth={2} className="h-5 w-5" />
            </button>
            <p className="text-center">
              <span className="block font-grotesk text-7xl font-bold tabular-nums leading-none tracking-[-0.04em] text-ink-950 dark:text-paper-50 sm:text-8xl">
                {guests}
              </span>
              <span className="mt-2 block text-sm text-ink-600 dark:text-paper-300">
                {t("tools.seating_chart.planner_guests_label")}
              </span>
            </p>
            <button
              type="button"
              onClick={() => setGuests((g) => clamp(g + 1, MIN_GUESTS, MAX_GUESTS))}
              disabled={guests >= MAX_GUESTS}
              aria-label="+1"
              className={roundBtn}
            >
              <Plus aria-hidden strokeWidth={2} className="h-5 w-5" />
            </button>
          </div>

          {/* The rail is drawn by two plain divs under a transparent native
              range, so the fill needs no inline colour and nothing about the
              layout moves while the thumb is dragged. */}
          <div className="relative mt-10 h-11">
            <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-paper-200 dark:bg-umber-700" />
            <div
              className="absolute top-1/2 left-0 h-1.5 -translate-y-1/2 rounded-full bg-ink-950 dark:bg-paper-50"
              style={{ width: `${pct}%` }}
            />
            <input
              type="range"
              min={MIN_GUESTS}
              max={MAX_GUESTS}
              step={1}
              value={guests}
              onChange={(e) => setGuests(clamp(Number(e.target.value), MIN_GUESTS, MAX_GUESTS))}
              aria-label={t("tools.seating_chart.planner_guests_label")}
              className="absolute inset-0 h-11 w-full cursor-pointer appearance-none bg-transparent focus-visible:outline-none [&::-moz-range-thumb]:h-7 [&::-moz-range-thumb]:w-7 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-[0_0_0_2px_theme(colors.ink.950),0_2px_6px_rgba(8,13,28,0.25)] [&::-webkit-slider-thumb]:h-7 [&::-webkit-slider-thumb]:w-7 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_0_0_2px_theme(colors.ink.950),0_2px_6px_rgba(8,13,28,0.25)] focus-visible:[&::-webkit-slider-thumb]:shadow-[0_0_0_2px_theme(colors.ink.950),0_0_0_6px_theme(colors.ink.200)]"
            />
          </div>
          <div className="mt-1 flex justify-between text-xs tabular-nums text-ink-500 dark:text-umber-300">
            <span>{MIN_GUESTS}</span>
            <span>{MAX_GUESTS}</span>
          </div>
        </div>
      )}

      {step === 2 && (
        <div
          role="radiogroup"
          aria-label={t("tools.seating_chart.planner_size_label")}
          className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4"
        >
          {TABLE_KINDS.map((k) => {
            const active = k === kind;
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setKind(k)}
                className={`rounded-2xl p-4 text-left transition-colors ${
                  active
                    ? "bg-paper-50 ring-2 ring-ink-950 dark:bg-umber-800 dark:ring-paper-50"
                    : "bg-paper-50 ring-1 ring-paper-200 hover:ring-ink-300 dark:bg-umber-800/60 dark:ring-umber-700"
                }`}
              >
                <TablePictogram kind={k} />
                <p className="mt-3 text-base font-semibold text-ink-950 dark:text-paper-50">
                  {t(`tools.seating_chart.planner_size_${k}`)}
                </p>
                <p className="mt-0.5 text-sm tabular-nums text-ink-600 dark:text-paper-300">
                  {t("tools.seating_chart.wizard_tables_for", { n: tableCountFor(guests, k) })}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {step === 3 && (
        <div className="mt-8">
          <div className="grid grid-cols-3 gap-4 border-b border-paper-200 pb-6 dark:border-umber-800">
            <Stat value={tableCount} label={t("tools.seating_chart.planner_tables_label")} />
            <Stat value={totalSeats} label={t("tools.seating_chart.planner_seats_label")} />
            <Stat
              value={spare === 0 ? "0" : `+${spare}`}
              label={
                spare === 0
                  ? t("tools.seating_chart.planner_spare_none")
                  : t("tools.seating_chart.planner_spare_label")
              }
            />
          </div>
          <div className="mt-6">
            <RoomPlan guests={guests} kind={kind} />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-ink-600 dark:text-paper-300">
            <span className="inline-flex items-center gap-2">
              <span className="h-3.5 w-3.5 rounded-full bg-ink-950 dark:bg-paper-100" />
              {t("tools.seating_chart.room_legend_taken")}
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-3.5 w-3.5 rounded-full border-2 border-dashed border-ink-300 dark:border-umber-500" />
              {t("tools.seating_chart.room_legend_empty")}
            </span>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-ink-600 dark:text-paper-300">
            {t("tools.seating_chart.planner_note")}
          </p>
        </div>
      )}

      <div className="mt-10 flex flex-wrap items-center justify-between gap-3">
        {step > 1 ? (
          <button
            type="button"
            onClick={() => setStep((s) => (s === 3 ? 2 : 1))}
            className={pillLight}
          >
            {t("tools.seating_chart.wizard_back")}
          </button>
        ) : (
          <span />
        )}
        {step < 3 ? (
          <button
            type="button"
            onClick={() => setStep((s) => (s === 1 ? 2 : 3))}
            className={pillDark}
          >
            {t("tools.seating_chart.wizard_next")}
          </button>
        ) : (
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => setStep(1)} className={pillLight}>
              {t("tools.seating_chart.wizard_restart")}
            </button>
            <Link to="/signup" className={pillDark}>
              {t("tools.seating_chart.cta_button")}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function Photo({
  src,
  w,
  h,
  className = "",
}: { src: string; w: number; h: number; className?: string }) {
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      width={w}
      height={h}
      decoding="async"
      className={`mb-3 h-auto w-full break-inside-avoid rounded-2xl object-cover ${className}`}
    />
  );
}

export default function SeatingChartPage() {
  const { t, locale } = useT();
  useDocumentMeta("tools.seating_chart.page_h1", "tools.seating_chart.page_intro");

  return (
    <PublicShell>
      <section>
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 pt-12 pb-14 sm:px-6 sm:pt-16 lg:grid-cols-[1fr_1fr] lg:gap-14 lg:px-8">
          <div>
            <h1 className="font-grotesk text-5xl font-bold leading-[1.02] tracking-[-0.035em] text-ink-950 dark:text-paper-50 sm:text-6xl lg:text-7xl">
              {t("tools.seating_chart.page_h1")}
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-600 dark:text-paper-300">
              {t("tools.seating_chart.page_intro")}
            </p>
            <a
              href="#planner"
              className="mt-8 inline-flex h-14 items-center justify-center rounded-full bg-ink-950 px-7 text-base font-semibold text-white transition-colors hover:bg-ink-800 dark:bg-paper-50 dark:text-ink-950 dark:hover:bg-paper-200"
            >
              {t("tools.seating_chart.hero_cta")}
            </a>
          </div>
          {/* Pinterest-style board of real reception tables. Decorative: the
              heading carries the meaning. */}
          <div className="columns-2 gap-3 [&>img:first-child]:mt-10">
            <Photo src="/design-photos/01-reception-pergola.jpg" w={1067} h={1600} />
            <Photo src="/design-photos/03-place-setting.jpg" w={1600} h={1067} />
            <Photo src="/design-photos/02-reception-candlelit.jpg" w={1600} h={1067} />
            <Photo src="/design-photos/07-candle.jpg" w={1067} h={1600} className="max-h-80" />
          </div>
        </div>
      </section>

      <section id="planner" className="scroll-mt-24">
        <div className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 lg:px-8">
          <Planner />
        </div>
      </section>

      <section>
        <div className="mx-auto grid max-w-6xl gap-12 px-4 pb-20 sm:px-6 lg:grid-cols-2 lg:px-8">
          <div>
            <h2 className={H2}>{t("tools.seating_chart.what_h2")}</h2>
            <p className="mt-5 text-base leading-relaxed text-ink-600 dark:text-paper-300">
              {t("tools.seating_chart.what_body")}
            </p>
          </div>
          <div>
            <h2 className={H2}>{t("tools.seating_chart.print_h2")}</h2>
            <p className="mt-5 text-base leading-relaxed text-ink-600 dark:text-paper-300">
              {t("tools.seating_chart.print_body")}
            </p>
            <ul className="mt-6 divide-y divide-paper-200 border-y border-paper-200 dark:divide-umber-800 dark:border-umber-800">
              {(["a4", "a6", "a3"] as const).map((k) => (
                <li
                  key={k}
                  className="py-4 text-base leading-relaxed text-ink-800 dark:text-paper-200"
                >
                  {t(`tools.seating_chart.print_li_${k}`)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto grid max-w-6xl gap-10 px-4 pb-20 sm:px-6 lg:grid-cols-[1fr_0.9fr] lg:items-center lg:gap-14 lg:px-8">
          <div>
            <h2 className={H2}>{t("tools.seating_chart.etiquette_h2")}</h2>
            <ol className="mt-8 space-y-6">
              {([1, 2, 3, 4] as const).map((n) => (
                <li key={n} className="flex gap-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-950 text-sm font-bold tabular-nums text-white dark:bg-paper-50 dark:text-ink-950">
                    {n}
                  </span>
                  <p className="text-base leading-relaxed text-ink-700 dark:text-paper-200">
                    {t(`tools.seating_chart.etiquette_li_${n}`)}
                  </p>
                </li>
              ))}
            </ol>
          </div>
          <img
            src="/design-photos/06-pampas-candles.jpg"
            alt=""
            aria-hidden="true"
            width={1600}
            height={1068}
            loading="lazy"
            decoding="async"
            className="h-auto w-full rounded-3xl object-cover"
          />
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-6 rounded-3xl bg-ink-950 px-6 py-10 text-white dark:bg-paper-50 dark:text-ink-950 sm:px-10 sm:py-12 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <h2 className="font-grotesk text-3xl font-bold leading-tight tracking-[-0.02em]">
                {t("tools.seating_chart.cta_h2")}
              </h2>
              <p className="mt-3 text-base leading-relaxed text-white/70 dark:text-ink-700">
                {t("tools.seating_chart.cta_body")}
              </p>
            </div>
            <Link
              to="/signup"
              className="inline-flex h-12 shrink-0 items-center justify-center rounded-full bg-white px-6 text-sm font-semibold text-ink-950 transition-colors hover:bg-paper-200 dark:bg-ink-950 dark:text-white dark:hover:bg-ink-800"
            >
              {t("tools.seating_chart.cta_button")}
            </Link>
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-3xl px-4 pb-20 sm:px-6">
          <h2 className={H2}>{t("tools.seating_chart.faq_h2")}</h2>
          <div className="mt-6 divide-y divide-paper-200 border-y border-paper-200 dark:divide-umber-800 dark:border-umber-800">
            {TOOL_FAQ[locale].seating_chart.map((entry) => (
              <details key={entry.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-semibold text-ink-950 dark:text-paper-50 [&::-webkit-details-marker]:hidden">
                  {entry.q}
                  <ChevronDown
                    aria-hidden
                    strokeWidth={2}
                    className="h-5 w-5 shrink-0 text-ink-500 transition-transform group-open:rotate-180"
                  />
                </summary>
                <p className="mt-3 text-base leading-relaxed text-ink-600 dark:text-paper-300">
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
