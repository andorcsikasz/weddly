// /app/vendors/messages?tab=compare: import vendor offers (PDF/email -> LLM ->
// JSON -> paste) and compare them. Everything shown is derived from the stored
// payload by shared/vendor_offers.ts, so the numbers here, the validator and
// the server agree by construction.

import {
  Check,
  ChevronDown,
  Copy,
  FileJson,
  Plus,
  Trash2,
  TriangleAlert,
  Wallet,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CoupleVendorThreadPreview } from "@shared/booking_messages";
import { offerBudgetBreakdown } from "@shared/offer_budget";
import type { Currency } from "@shared/types";
import {
  OFFER_ITEM_KINDS,
  type OfferItemKind,
  type VendorOffer,
  type VendorOfferPayload,
  buildOfferPrompt,
  offerComposition,
  offerFreshness,
  offerMismatch,
  offerOptionalTotal,
  offerTotalAt,
  parseVendorOffer,
} from "@shared/vendor_offers";
import { ApiError } from "../lib/api";
import { OfferBudgetDialog } from "./OfferBudgetDialog";
import { bookingMessagesApi, coupleApi, vendorOfferApi } from "../lib/endpoints";
import { budgetGuestCount } from "../lib/budget";
import { formatDate, formatMoney, formatMoneyCompact } from "../lib/format";
import { useT } from "../lib/i18n";
import { Skeleton, useConfirm, useToast } from "./ui";

const MAX_COMPARED = 6;

// One entry per vendor slot, in fixed order: a vendor keeps its colour when a
// filter changes how many are shown. Literal strings so Tailwind keeps them.
const SERIES = [
  {
    dot: "bg-ink-900 dark:bg-paper-50",
    line: "stroke-ink-900 dark:stroke-paper-50",
    ring: "fill-ink-900 dark:fill-paper-50",
  },
  { dot: "bg-blush-500", line: "stroke-blush-500", ring: "fill-blush-500" },
  { dot: "bg-sage-600", line: "stroke-sage-600", ring: "fill-sage-600" },
  { dot: "bg-amber-500", line: "stroke-amber-500", ring: "fill-amber-500" },
  { dot: "bg-umber-500", line: "stroke-umber-500", ring: "fill-umber-500" },
  { dot: "bg-steel-500", line: "stroke-steel-500", ring: "fill-steel-500" },
] as const;

const KIND_BG: Record<OfferItemKind, string> = {
  base: "bg-ink-800 dark:bg-paper-200",
  per_person: "bg-sage-500",
  extra: "bg-amber-400",
  fee: "bg-umber-400",
  discount: "bg-blush-400",
};

const FRESH_TONE = {
  fresh: "bg-sage-100 text-sage-800 dark:bg-sage-900/40 dark:text-sage-200",
  aging: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  stale: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  expired: "bg-paper-200 text-ink-600 dark:bg-umber-700 dark:text-paper-300",
} as const;

type Offer = VendorOffer;

const vendorKey = (o: Offer) => o.supplier_id ?? `n:${o.vendor_name.trim().toLowerCase()}`;
const todayIso = () => new Date().toISOString().slice(0, 10);

interface VendorRow {
  key: string;
  latest: Offer;
  history: Offer[]; // oldest first
}

function groupOffers(offers: Offer[]): Map<string, VendorRow[]> {
  const byVendor = new Map<string, Offer[]>();
  for (const o of offers) {
    const k = `${o.category}:${o.currency}|${vendorKey(o)}`;
    byVendor.set(k, [...(byVendor.get(k) ?? []), o]);
  }
  const groups = new Map<string, VendorRow[]>();
  for (const [k, list] of byVendor) {
    const sorted = [...list].sort((a, b) => a.quoted_at.localeCompare(b.quoted_at) || a.id - b.id);
    const latest = sorted[sorted.length - 1];
    if (!latest) continue;
    const g = `${latest.category}:${latest.currency}`;
    groups.set(g, [...(groups.get(g) ?? []), { key: k, latest, history: sorted }]);
  }
  for (const rows of groups.values()) rows.sort((a, b) => a.key.localeCompare(b.key));
  return groups;
}

function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map(
    (v, i) => `${(i / (values.length - 1)) * 56 + 2},${18 - ((v - min) / span) * 14}`,
  );
  const last = pts[pts.length - 1]?.split(",") ?? ["0", "0"];
  return (
    <svg viewBox="0 0 60 20" className={`h-5 w-14 ${className ?? ""}`} aria-hidden="true">
      <polyline
        points={pts.join(" ")}
        fill="none"
        strokeWidth="1.5"
        className="stroke-ink-500 dark:stroke-paper-300"
      />
      <circle cx={last[0]} cy={last[1]} r="2.5" className="fill-ink-900 dark:fill-paper-50" />
    </svg>
  );
}

/** An offer carries a total when it has line items to sum or a printed figure.
 *  With neither, `offerTotalAt` answers 0, which is "nothing stated", not "free". */
function hasKnownTotal(p: VendorOfferPayload): boolean {
  return p.line_items.length > 0 || p.stated_total !== null;
}

export function OfferCompare() {
  const { t, locale } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [threads, setThreads] = useState<CoupleVendorThreadPreview[]>([]);
  const [meta, setMeta] = useState<{
    currency: Currency;
    guests: number | null;
    date: string | null;
  }>({
    currency: "EUR",
    guests: null,
    date: null,
  });
  const [importOpen, setImportOpen] = useState(false);
  const [group, setGroup] = useState<string | null>(null);
  const [guests, setGuests] = useState<number | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  // The chosen offer whose budget breakdown is being previewed.
  const [budgetFor, setBudgetFor] = useState<Offer | null>(null);

  const load = useCallback(() => {
    vendorOfferApi
      .list()
      .then(({ offers: list }) => setOffers(list))
      .catch(() => setOffers([]));
  }, []);

  useEffect(() => {
    load();
    bookingMessagesApi
      .coupleThreads()
      .then(({ threads: list }) => setThreads(list))
      .catch(() => undefined);
    coupleApi
      .current()
      .then(({ couple }) => {
        if (couple)
          setMeta({
            currency: couple.currency ?? "EUR",
            // The same headcount the budget slider opens on, so a per-guest
            // figure here and there can't disagree.
            guests: budgetGuestCount(couple),
            date: couple.wedding_date ?? null,
          });
      })
      .catch(() => undefined);
  }, [load]);

  const groups = useMemo(() => groupOffers(offers ?? []), [offers]);
  const groupKeys = useMemo(
    () =>
      [...groups.keys()].sort(
        (a, b) => (groups.get(b)?.length ?? 0) - (groups.get(a)?.length ?? 0),
      ),
    [groups],
  );
  const activeGroup = group && groups.has(group) ? group : (groupKeys[0] ?? null);
  const allRows = useMemo(() => groups.get(activeGroup ?? "") ?? [], [groups, activeGroup]);
  // Rejected vendors stay in the list but out of the charts unless re-opened.
  const rows = allRows.filter((r) => !hidden.has(r.key)).slice(0, MAX_COMPARED);
  const today = todayIso();

  const guestDefault = meta.guests ?? rows[0]?.latest.payload.guest_count ?? 80;
  const g = guests ?? guestDefault;
  const gMax = Math.max(300, Math.ceil((guestDefault * 2) / 50) * 50);

  const act = async (fn: () => Promise<unknown>, okKey?: string) => {
    try {
      await fn();
      if (okKey) toast.success(t(okKey));
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  };

  const remove = async (o: Offer) => {
    const ok = await confirm({
      title: t("offers.remove_title"),
      body: t("offers.remove_body"),
      confirmLabel: t("offers.remove"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (ok) void act(() => vendorOfferApi.remove(o.id));
  };

  if (offers === null) {
    return (
      <div className="space-y-3">
        <Skeleton variant="line" height="6rem" />
        <Skeleton variant="line" height="14rem" />
      </div>
    );
  }

  const cur = rows[0]?.latest.currency ?? meta.currency;
  const money = (n: number) => formatMoney(n, cur, locale);
  const totals = rows.map((r) => offerTotalAt(r.latest.payload, g));
  const minTotal = totals.length > 1 ? Math.min(...totals) : null;

  return (
    <div className="space-y-5">
      <section className="card flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink-900 dark:text-paper-50">
            {t("offers.intro_title")}
          </h2>
          <p className="mt-0.5 max-w-2xl text-sm text-ink-600 dark:text-paper-300">
            {t("offers.intro_body")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setImportOpen((v) => !v)}
          aria-expanded={importOpen}
          className="inline-flex h-10 items-center gap-2 rounded-full bg-ink-900 px-5 text-sm font-semibold text-white transition hover:bg-ink-800 dark:bg-paper-50 dark:text-ink-900"
        >
          {importOpen ? <X size={16} aria-hidden /> : <Plus size={16} aria-hidden />}
          {importOpen ? t("offers.import_close") : t("offers.import_cta")}
        </button>
      </section>

      {importOpen && (
        <ImportPanel
          threads={threads}
          currency={meta.currency}
          guestCount={meta.guests}
          eventDate={meta.date}
          onSaved={(o) => {
            setImportOpen(false);
            setGroup(`${o.category}:${o.currency}`);
            setHidden(new Set());
            toast.success(t("offers.saved"));
            load();
          }}
        />
      )}

      {offers.length === 0 ? (
        !importOpen && (
          <div className="card text-center">
            <FileJson
              className="mx-auto h-8 w-8 text-steel-600 dark:text-steel-300"
              strokeWidth={1.5}
              aria-hidden
            />
            <p className="mt-2 font-medium text-ink-900 dark:text-paper-50">
              {t("offers.empty_title")}
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-ink-600 dark:text-paper-300">
              {t("offers.empty_body")}
            </p>
          </div>
        )
      ) : (
        <>
          <nav className="flex flex-wrap gap-2" aria-label={t("offers.pick_vendors")}>
            {groupKeys.map((k) => {
              const first = groups.get(k)?.[0]?.latest;
              if (!first) return null;
              const multiCur =
                groupKeys.filter((x) => x.startsWith(`${first.category}:`)).length > 1;
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={k === activeGroup}
                  onClick={() => {
                    setGroup(k);
                    setHidden(new Set());
                  }}
                  className={`rounded-full border px-3.5 py-1.5 text-sm transition ${
                    k === activeGroup
                      ? "border-ink-900 bg-ink-900 text-white dark:border-paper-50 dark:bg-paper-50 dark:text-ink-900"
                      : "border-paper-300 bg-white text-ink-700 hover:bg-paper-50 dark:border-umber-600 dark:bg-umber-800 dark:text-paper-200"
                  }`}
                >
                  {t(`suppliers.cat.${first.category}`)}
                  {multiCur ? ` (${first.currency})` : ""}
                  <span className="ml-1.5 tabular-nums opacity-60">{groups.get(k)?.length}</span>
                </button>
              );
            })}
          </nav>

          {allRows.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-ink-500 dark:text-paper-400">
                {t("offers.pick_vendors")} · {t("offers.pick_max")}
              </span>
              {allRows.map((r, i) => {
                const on = rows.some((x) => x.key === r.key);
                return (
                  <button
                    key={r.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setHidden((prev) => {
                        const n = new Set(prev);
                        if (on) n.add(r.key);
                        else n.delete(r.key);
                        return n;
                      })
                    }
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${
                      on
                        ? "border-ink-300 bg-white text-ink-900 dark:border-umber-500 dark:bg-umber-800 dark:text-paper-50"
                        : "border-dashed border-paper-300 text-ink-400 dark:border-umber-600 dark:text-paper-500"
                    }`}
                  >
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${on ? SERIES[i % SERIES.length]?.dot : "bg-paper-300"}`}
                    />
                    {r.latest.vendor_name}
                  </button>
                );
              })}
            </div>
          )}

          {rows.length > 0 && (
            <>
              <section className="card">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-ink-900 dark:text-paper-50">
                      {t("offers.chart_total_title", { n: g })}
                    </h3>
                    <p className="text-xs text-ink-500 dark:text-paper-400">
                      {t("offers.chart_total_sub")}
                    </p>
                  </div>
                  <label className="flex min-w-[14rem] flex-1 items-center gap-3 sm:max-w-sm">
                    <span className="text-xs text-ink-600 dark:text-paper-300">
                      {t("offers.guests_label")}
                    </span>
                    <input
                      type="range"
                      min={10}
                      max={gMax}
                      step={5}
                      value={g}
                      onChange={(e) => setGuests(Number(e.target.value))}
                      aria-label={t("offers.guests_label")}
                      className="h-1.5 flex-1 cursor-pointer accent-ink-900 dark:accent-paper-50"
                    />
                    <span className="w-10 text-right text-sm font-semibold tabular-nums text-ink-900 dark:text-paper-50">
                      {g}
                    </span>
                  </label>
                </div>
                <p className="mt-1 text-[11px] text-ink-400 dark:text-paper-500">
                  {t("offers.guests_hint")}
                </p>
                <TotalBars
                  rows={rows}
                  guests={g}
                  money={money}
                  minTotal={minTotal}
                  allRows={allRows}
                  t={t}
                />
                <Legend t={t} />
              </section>

              {rows.length > 1 && (
                <section className="card">
                  <h3 className="text-sm font-semibold text-ink-900 dark:text-paper-50">
                    {t("offers.chart_curve_title")}
                  </h3>
                  <p className="text-xs text-ink-500 dark:text-paper-400">
                    {t("offers.chart_curve_sub")}
                  </p>
                  <CurveChart
                    rows={rows}
                    allRows={allRows}
                    guests={g}
                    max={gMax}
                    currency={cur}
                    onPick={setGuests}
                    t={t}
                  />
                </section>
              )}

              <section className="card overflow-x-auto">
                <div
                  className="grid min-w-max gap-x-3"
                  style={{ gridTemplateColumns: `9rem repeat(${rows.length}, minmax(12rem, 1fr))` }}
                >
                  <div />
                  {rows.map((r) => {
                    const o = r.latest;
                    const idx = Math.max(
                      0,
                      allRows.findIndex((x) => x.key === r.key),
                    );
                    const fr = offerFreshness(o, today);
                    const status = o.status;
                    return (
                      <div
                        key={r.key}
                        className={`rounded-2xl border p-3 ${
                          status === "chosen"
                            ? "border-sage-500 bg-sage-50 dark:bg-sage-900/20"
                            : "border-paper-200 dark:border-umber-700"
                        } ${status === "rejected" ? "opacity-60" : ""}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="flex items-center gap-1.5 truncate font-semibold text-ink-900 dark:text-paper-50">
                              <span
                                className={`h-2.5 w-2.5 shrink-0 rounded-full ${SERIES[idx % SERIES.length]?.dot}`}
                              />
                              <span className="truncate">{o.vendor_name}</span>
                            </p>
                            <p className="text-[11px] uppercase tracking-wide text-ink-500 dark:text-paper-400">
                              {t(`suppliers.cat.${o.category}`)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void remove(o)}
                            aria-label={t("offers.remove")}
                            title={t("offers.remove")}
                            className="rounded-full p-1.5 text-ink-400 hover:bg-paper-100 hover:text-ink-900 dark:hover:bg-umber-700"
                          >
                            <Trash2 size={14} aria-hidden />
                          </button>
                        </div>
                        <span
                          className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${FRESH_TONE[fr.state]}`}
                        >
                          {t(`offers.${fr.state}`)}
                        </span>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {status === "open" || status === "shortlisted" ? (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  void act(() => vendorOfferApi.setStatus(o.id, "chosen"))
                                }
                                className="rounded-full bg-ink-900 px-3 py-1 text-xs font-semibold text-white dark:bg-paper-50 dark:text-ink-900"
                              >
                                {t("offers.decision_choose")}
                              </button>
                              {status === "open" && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void act(() => vendorOfferApi.setStatus(o.id, "shortlisted"))
                                  }
                                  className="rounded-full border border-ink-300 px-3 py-1 text-xs text-ink-700 dark:border-umber-500 dark:text-paper-200"
                                >
                                  {t("offers.decision_shortlist")}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  void act(() => vendorOfferApi.setStatus(o.id, "rejected"))
                                }
                                className="rounded-full px-2 py-1 text-xs text-ink-500 hover:underline dark:text-paper-400"
                              >
                                {t("offers.decision_reject")}
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void act(() => vendorOfferApi.setStatus(o.id, "open"))}
                              className="inline-flex items-center gap-1 rounded-full border border-ink-300 px-3 py-1 text-xs text-ink-700 dark:border-umber-500 dark:text-paper-200"
                            >
                              {status === "chosen" && <Check size={12} aria-hidden />}
                              {t(
                                status === "chosen"
                                  ? "offers.decision_chosen"
                                  : "offers.decision_rejected",
                              )}{" "}
                              · {t("offers.decision_reopen")}
                            </button>
                          )}
                        </div>
                        {status === "shortlisted" && (
                          <p className="mt-1.5 text-[11px] text-sage-700 dark:text-sage-300">
                            {t("offers.decision_shortlisted")}
                          </p>
                        )}
                        {status === "chosen" && (
                          <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                            {(o.budget_lines ?? 0) > 0 ? (
                              <>
                                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-sage-700 dark:text-sage-300">
                                  <Check size={12} strokeWidth={1.5} aria-hidden />
                                  {t("offers.budget.in_budget", { n: o.budget_lines ?? 0 })}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setBudgetFor(o)}
                                  className="text-xs text-ink-700 underline underline-offset-4 dark:text-paper-200"
                                >
                                  {t("offers.budget.update")}
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setBudgetFor(o)}
                                className="inline-flex items-center gap-1.5 rounded-full bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white dark:bg-paper-50 dark:text-ink-900"
                              >
                                <Wallet size={13} strokeWidth={1.5} aria-hidden />
                                {t("offers.budget.add")}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  <MatrixRow label={t("offers.row_total")}>
                    {rows.map((r, i) => {
                      const tot = totals[i] ?? 0;
                      const best = minTotal !== null && tot === minTotal;
                      const mis = offerMismatch(r.latest.payload);
                      // An offer with no figures (no line items, no printed total)
                      // is not a zero-pound offer. Say so instead of printing Ft 0.
                      if (!hasKnownTotal(r.latest.payload)) {
                        return (
                          <div key={r.key} className="py-3">
                            <p className="text-sm text-ink-500 dark:text-paper-400">
                              {t("offers.unknown")}
                            </p>
                          </div>
                        );
                      }
                      return (
                        <div key={r.key} className="py-3">
                          <p
                            className={`text-lg font-semibold tabular-nums ${best ? "text-sage-700 dark:text-sage-300" : "text-ink-900 dark:text-paper-50"}`}
                          >
                            {money(tot)}
                          </p>
                          <p className="text-[11px] text-ink-500 dark:text-paper-400">
                            {best
                              ? t("offers.cheapest")
                              : minTotal !== null
                                ? t("offers.vs_cheapest", { amount: money(tot - minTotal) })
                                : ""}
                          </p>
                          {mis && (
                            <p className="mt-1 flex items-start gap-1 text-[11px] text-amber-700 dark:text-amber-300">
                              <TriangleAlert size={12} className="mt-0.5 shrink-0" aria-hidden />
                              {t("offers.mismatch", {
                                stated: money(mis.stated),
                                computed: money(mis.computed),
                              })}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </MatrixRow>
                  <MatrixRow label={t("offers.row_per_guest")}>
                    {rows.map((r, i) => (
                      <Cell key={r.key} muted={!hasKnownTotal(r.latest.payload)}>
                        {hasKnownTotal(r.latest.payload)
                          ? money(Math.round((totals[i] ?? 0) / Math.max(1, g)))
                          : t("offers.unknown")}
                      </Cell>
                    ))}
                  </MatrixRow>
                  <MatrixRow label={t("offers.row_by_category")}>
                    {rows.map((r) => {
                      // The same split the budget will hold, so what is compared
                      // here is what lands in each budget category.
                      const split = Object.entries(
                        offerBudgetBreakdown(r.latest.payload, { guests: g }).by_category,
                      )
                        .filter(([, v]) => (v ?? 0) > 0)
                        .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
                      if (split.length === 0)
                        return (
                          <Cell key={r.key} muted>
                            {t("offers.unknown")}
                          </Cell>
                        );
                      return (
                        <ul key={r.key} className="space-y-0.5 py-3 text-xs">
                          {split.map(([cat, v]) => (
                            <li key={cat} className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-ink-600 dark:text-paper-300">
                                {t(`budget.cat.${cat}`)}
                              </span>
                              <span className="shrink-0 tabular-nums text-ink-900 dark:text-paper-50">
                                {money(v ?? 0)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      );
                    })}
                  </MatrixRow>
                  <MatrixRow label={t("offers.row_deposit")}>
                    {rows.map((r) => (
                      <Cell key={r.key} muted={r.latest.payload.deposit_amount === null}>
                        {r.latest.payload.deposit_amount === null
                          ? t("offers.unknown")
                          : money(r.latest.payload.deposit_amount)}
                      </Cell>
                    ))}
                  </MatrixRow>
                  <MatrixRow label={t("offers.row_optional")}>
                    {rows.map((r) => {
                      const opt = offerOptionalTotal({ ...r.latest.payload, guest_count: g });
                      return (
                        <Cell key={r.key} muted={opt === 0}>
                          {opt === 0 ? "-" : `+${money(opt)}`}
                        </Cell>
                      );
                    })}
                  </MatrixRow>
                  <MatrixRow label={t("offers.row_validated")}>
                    {rows.map((r) => (
                      <div key={r.key} className="py-3 text-sm text-ink-900 dark:text-paper-50">
                        <p className="font-medium">{formatDate(r.latest.quoted_at, locale)}</p>
                        <p className="text-[11px] text-ink-500 dark:text-paper-400">
                          {t("offers.imported_on", {
                            date: formatDate(
                              new Date(r.latest.created_at).toISOString().slice(0, 10),
                              locale,
                            ),
                          })}
                        </p>
                      </div>
                    ))}
                  </MatrixRow>
                  <MatrixRow label={t("offers.row_valid_until")}>
                    {rows.map((r) => {
                      const fr = offerFreshness(r.latest, today);
                      return (
                        <div key={r.key} className="py-3 text-sm text-ink-900 dark:text-paper-50">
                          {r.latest.valid_until ? (
                            <>
                              <p>{formatDate(r.latest.valid_until, locale)}</p>
                              {fr.days_left !== null && fr.days_left >= 0 && (
                                <p className="text-[11px] text-ink-500 dark:text-paper-400">
                                  {t("offers.days_left", { n: fr.days_left })}
                                </p>
                              )}
                            </>
                          ) : (
                            <span className="text-ink-400 dark:text-paper-500">
                              {t("offers.no_expiry")}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </MatrixRow>
                  <MatrixRow label={t("offers.row_included")}>
                    {rows.map((r) => (
                      <Chips
                        key={r.key}
                        items={r.latest.payload.inclusions}
                        tone="ok"
                        empty={t("offers.unknown")}
                      />
                    ))}
                  </MatrixRow>
                  <MatrixRow label={t("offers.row_excluded")}>
                    {rows.map((r) => (
                      <Chips
                        key={r.key}
                        items={r.latest.payload.exclusions}
                        tone="warn"
                        empty={t("offers.unknown")}
                      />
                    ))}
                  </MatrixRow>
                  <MatrixRow label={t("offers.row_cancellation")}>
                    {rows.map((r) => (
                      <Cell key={r.key} muted={!r.latest.payload.cancellation}>
                        {r.latest.payload.cancellation ?? t("offers.unknown")}
                      </Cell>
                    ))}
                  </MatrixRow>
                  <MatrixRow label={t("offers.row_payment")}>
                    {rows.map((r) => (
                      <Cell key={r.key} muted={!r.latest.payload.payment_terms}>
                        {r.latest.payload.payment_terms ?? t("offers.unknown")}
                      </Cell>
                    ))}
                  </MatrixRow>
                  <MatrixRow label={t("offers.row_history")}>
                    {rows.map((r) => {
                      const prev = r.history[r.history.length - 2];
                      const delta = prev ? r.latest.total - prev.total : 0;
                      return (
                        <div key={r.key} className="flex items-center gap-2 py-3 text-sm">
                          {r.history.length > 1 ? (
                            <>
                              <Sparkline values={r.history.map((h) => h.total)} />
                              <span className="text-[11px] text-ink-500 dark:text-paper-400">
                                {t("offers.history_n", { n: r.history.length })}
                                {delta !== 0 && (
                                  <span
                                    className={
                                      delta < 0
                                        ? "ml-1 text-sage-700 dark:text-sage-300"
                                        : "ml-1 text-blush-700 dark:text-blush-300"
                                    }
                                  >
                                    {delta < 0 ? "↓" : "↑"} {money(Math.abs(delta))}
                                  </span>
                                )}
                              </span>
                            </>
                          ) : (
                            <span className="text-ink-300 dark:text-umber-500">-</span>
                          )}
                        </div>
                      );
                    })}
                  </MatrixRow>
                </div>
              </section>
            </>
          )}
        </>
      )}

      <OfferBudgetDialog
        open={budgetFor !== null}
        offer={budgetFor}
        guests={g}
        onClose={() => setBudgetFor(null)}
        onChanged={load}
      />
    </div>
  );
}

function MatrixRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <div className="flex items-center border-t border-paper-200 py-3 text-xs text-ink-500 dark:border-umber-700 dark:text-umber-300">
        {label}
      </div>
      {Array.isArray(children)
        ? children.map((c, i) => (
            <div key={i} className="border-t border-paper-200 dark:border-umber-700">
              {c}
            </div>
          ))
        : children}
    </>
  );
}

function Cell({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <div
      className={`py-3 text-sm ${muted ? "text-ink-400 dark:text-paper-500" : "text-ink-900 dark:text-paper-50"}`}
    >
      {children}
    </div>
  );
}

function Chips({ items, tone, empty }: { items: string[]; tone: "ok" | "warn"; empty: string }) {
  if (items.length === 0) return <Cell muted>{empty}</Cell>;
  return (
    <ul className="flex flex-wrap gap-1 py-3">
      {items.map((s) => (
        <li
          key={s}
          className={`rounded-full px-2 py-0.5 text-[11px] ${
            tone === "ok"
              ? "bg-sage-100 text-sage-800 dark:bg-sage-900/40 dark:text-sage-200"
              : "bg-paper-100 text-ink-600 dark:bg-umber-700 dark:text-paper-300"
          }`}
        >
          {s}
        </li>
      ))}
    </ul>
  );
}

function Legend({ t }: { t: (k: string, p?: Record<string, string | number>) => string }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-600 dark:text-paper-300">
      {OFFER_ITEM_KINDS.filter((k) => k !== "discount").map((k) => (
        <li key={k} className="inline-flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-sm ${KIND_BG[k]}`} />
          {t(`offers.kind_${k}`)}
        </li>
      ))}
    </ul>
  );
}

function TotalBars({
  rows,
  allRows,
  guests,
  money,
  minTotal,
  t,
}: {
  rows: VendorRow[];
  allRows: VendorRow[];
  guests: number;
  money: (n: number) => string;
  minTotal: number | null;
  t: (k: string, p?: Record<string, string | number>) => string;
}) {
  const data = rows
    .map((r) => {
      const p = r.latest.payload;
      const total = offerTotalAt(p, guests);
      const comp = offerComposition(p, guests);
      const parts = comp.length > 0 ? comp : [{ kind: "base" as OfferItemKind, amount: total }];
      const sum = parts.reduce((s, x) => s + x.amount, 0) || 1;
      return {
        r,
        total,
        parts,
        sum,
        idx: Math.max(
          0,
          allRows.findIndex((x) => x.key === r.key),
        ),
      };
    })
    .sort((a, b) => a.total - b.total);
  const max = Math.max(1, ...data.map((d) => d.total));
  return (
    <ul className="mt-4 space-y-3">
      {data.map(({ r, total, parts, sum, idx }) => (
        <li key={r.key} className="grid grid-cols-[minmax(6rem,11rem)_1fr_auto] items-center gap-3">
          <span className="flex min-w-0 items-center gap-1.5 text-sm text-ink-900 dark:text-paper-50">
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${SERIES[idx % SERIES.length]?.dot}`}
            />
            <span className="truncate">{r.latest.vendor_name}</span>
          </span>
          <div
            className="flex h-6 overflow-hidden rounded-r-md"
            style={{ width: `${Math.max(2, (total / max) * 100)}%` }}
          >
            {parts.map((p) => (
              <span
                key={p.kind}
                title={`${t(`offers.kind_${p.kind}`)}: ${money(Math.round((p.amount / sum) * total))}`}
                className={`${KIND_BG[p.kind]} mr-0.5 last:mr-0 motion-safe:transition-[width] motion-safe:duration-300`}
                style={{ width: `${(p.amount / sum) * 100}%` }}
              />
            ))}
          </div>
          <span className="text-right text-sm font-semibold tabular-nums text-ink-900 dark:text-paper-50">
            {money(total)}
            {minTotal !== null && total === minTotal && (
              <span className="ml-1.5 rounded-full bg-sage-100 px-1.5 py-0.5 text-[10px] font-medium text-sage-800 dark:bg-sage-900/40 dark:text-sage-200">
                {t("offers.cheapest")}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function CurveChart({
  rows,
  allRows,
  guests,
  max,
  currency,
  onPick,
  t,
}: {
  rows: VendorRow[];
  allRows: VendorRow[];
  guests: number;
  max: number;
  currency: Currency;
  onPick: (g: number) => void;
  t: (k: string, p?: Record<string, string | number>) => string;
}) {
  const { locale } = useT();
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 240;
  const L = 52;
  const R = 12;
  const T = 12;
  const B = 28;
  const MIN = 10;
  const xs = useMemo(() => {
    const out: number[] = [];
    for (let x = MIN; x <= max; x += 5) out.push(x);
    return out;
  }, [max]);
  const series = rows.map((r) => ({
    r,
    idx: Math.max(
      0,
      allRows.findIndex((x) => x.key === r.key),
    ),
    ys: xs.map((x) => offerTotalAt(r.latest.payload, x)),
  }));
  const yMax = Math.max(1, ...series.flatMap((s) => s.ys)) * 1.08;
  const sx = (x: number) => L + ((x - MIN) / (max - MIN)) * (W - L - R);
  const sy = (y: number) => T + (1 - y / yMax) * (H - T - B);
  const at = hover ?? guests;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);

  const pick = (clientX: number, el: SVGSVGElement) => {
    const box = el.getBoundingClientRect();
    const x = ((clientX - box.left) / box.width) * W;
    const raw = MIN + ((x - L) / (W - L - R)) * (max - MIN);
    return Math.min(max, Math.max(MIN, Math.round(raw / 5) * 5));
  };

  return (
    <div className="relative mt-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full cursor-crosshair"
        role="img"
        aria-label={t("offers.chart_curve_title")}
        onMouseMove={(e) => setHover(pick(e.clientX, e.currentTarget))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => onPick(pick(e.clientX, e.currentTarget))}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={L}
              x2={W - R}
              y1={sy(v)}
              y2={sy(v)}
              className="stroke-paper-200 dark:stroke-umber-700"
              strokeWidth="1"
            />
            <text
              x={L - 6}
              y={sy(v) + 3}
              textAnchor="end"
              className="fill-ink-400 text-[10px] dark:fill-paper-400"
            >
              {formatMoneyCompact(v, currency, locale)}
            </text>
          </g>
        ))}
        {[
          MIN,
          ...[0.25, 0.5, 0.75].map((f) => Math.round((MIN + f * (max - MIN)) / 5) * 5),
          max,
        ].map((x) => (
          <text
            key={x}
            x={sx(x)}
            y={H - 8}
            textAnchor="middle"
            className="fill-ink-400 text-[10px] dark:fill-paper-400"
          >
            {x}
          </text>
        ))}
        {series.map((s) => (
          <polyline
            key={s.r.key}
            fill="none"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            className={SERIES[s.idx % SERIES.length]?.line}
            points={xs.map((x, i) => `${sx(x)},${sy(s.ys[i] ?? 0)}`).join(" ")}
          />
        ))}
        <line
          x1={sx(at)}
          x2={sx(at)}
          y1={T}
          y2={H - B}
          strokeDasharray="3 3"
          className="stroke-ink-400 dark:stroke-paper-400"
          strokeWidth="1"
        />
        {series.map((s) => {
          const i = xs.indexOf(at);
          const y = s.ys[i] ?? offerTotalAt(s.r.latest.payload, at);
          return (
            <circle
              key={s.r.key}
              cx={sx(at)}
              cy={sy(y)}
              r="4.5"
              strokeWidth="2"
              className={`${SERIES[s.idx % SERIES.length]?.ring} stroke-white dark:stroke-umber-800`}
            />
          );
        })}
      </svg>
      <div
        className="pointer-events-none absolute top-1 rounded-xl border border-paper-200 bg-white/95 px-3 py-2 text-xs shadow-soft dark:border-umber-600 dark:bg-umber-800/95"
        style={{
          left: `${Math.min(70, Math.max(10, (sx(at) / W) * 100))}%`,
          transform: "translateX(-50%)",
        }}
      >
        <p className="mb-1 font-medium text-ink-900 dark:text-paper-50">
          {t("offers.curve_at", { n: at })}
        </p>
        {[...series]
          .map((s) => ({ s, v: offerTotalAt(s.r.latest.payload, at) }))
          .sort((a, b) => a.v - b.v)
          .map(({ s, v }) => (
            <p
              key={s.r.key}
              className="flex items-center justify-between gap-4 tabular-nums text-ink-700 dark:text-paper-200"
            >
              <span className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${SERIES[s.idx % SERIES.length]?.dot}`} />
                {s.r.latest.vendor_name}
              </span>
              {formatMoney(v, currency, locale)}
            </p>
          ))}
      </div>
    </div>
  );
}

function ImportPanel({
  threads,
  currency,
  guestCount,
  eventDate,
  onSaved,
}: {
  threads: CoupleVendorThreadPreview[];
  currency: Currency;
  guestCount: number | null;
  eventDate: string | null;
  onSaved: (o: Offer) => void;
}) {
  const { t, locale } = useT();
  const toast = useToast();
  const [text, setText] = useState("");
  const [copied, setCopied] = useState<"prompt" | "errors" | null>(null);
  const [link, setLink] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const prompt = useMemo(
    () => buildOfferPrompt({ currency, guestCount, eventDate, today: todayIso() }),
    [currency, guestCount, eventDate],
  );
  const parsed = useMemo(() => (text.trim() ? parseVendorOffer(text) : null), [text]);

  const guess = useMemo(() => {
    if (!parsed?.ok) return "";
    const name = parsed.offer.vendor_name.toLowerCase();
    return (
      threads.find(
        (x) =>
          x.vendor_name.toLowerCase().includes(name) || name.includes(x.vendor_name.toLowerCase()),
      )?.supplier_id ?? ""
    );
  }, [parsed, threads]);
  const supplierId = link || guess;

  const copy = async (what: "prompt" | "errors", value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      toast.error(t("common.error_generic"));
    }
  };

  const save = async () => {
    if (!parsed?.ok) return;
    setSaving(true);
    try {
      const { offer } = await vendorOfferApi.import(parsed.offer, supplierId || null);
      onSaved(offer);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("offers.save_failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card grid gap-5 lg:grid-cols-2">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-ink-900 dark:text-paper-50">
          {t("offers.step1_title")}
        </h3>
        <p className="text-sm text-ink-600 dark:text-paper-300">{t("offers.step1_body")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void copy("prompt", prompt)}
            className="inline-flex h-9 items-center gap-2 rounded-full bg-ink-900 px-4 text-sm font-semibold text-white dark:bg-paper-50 dark:text-ink-900"
          >
            {copied === "prompt" ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
            {copied === "prompt" ? t("offers.copied") : t("offers.copy_prompt")}
          </button>
          <button
            type="button"
            onClick={() => setShowPrompt((v) => !v)}
            aria-expanded={showPrompt}
            className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-900 dark:text-paper-400"
          >
            <ChevronDown size={14} className={showPrompt ? "rotate-180" : ""} aria-hidden />
            JSON
          </button>
        </div>
        {showPrompt && (
          <pre className="max-h-64 overflow-auto rounded-xl bg-paper-100 p-3 text-[11px] leading-relaxed text-ink-700 dark:bg-umber-900 dark:text-paper-300">
            {prompt}
          </pre>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-ink-900 dark:text-paper-50">
          {t("offers.step2_title")}
        </h3>
        <p className="text-sm text-ink-600 dark:text-paper-300">{t("offers.step2_body")}</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("offers.paste_placeholder")}
          rows={6}
          spellCheck={false}
          className="input w-full font-mono text-xs"
        />
        {parsed && !parsed.ok && (
          <div
            role="alert"
            className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200"
          >
            <p className="font-medium">{t("offers.invalid_title")}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {parsed.errors.slice(0, 8).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() =>
                void copy(
                  "errors",
                  `Fix these problems in your last JSON and return only the corrected JSON:\n- ${parsed.errors.join("\n- ")}`,
                )
              }
              className="mt-2 inline-flex items-center gap-1 underline"
            >
              {copied === "errors" ? (
                <Check size={12} aria-hidden />
              ) : (
                <Copy size={12} aria-hidden />
              )}
              {copied === "errors" ? t("offers.copied") : t("offers.copy_errors")}
            </button>
          </div>
        )}
        {parsed?.ok && (
          <div className="space-y-2 rounded-xl bg-sage-50 p-3 text-sm text-sage-900 dark:bg-sage-900/20 dark:text-sage-100">
            <p className="flex items-start gap-1.5">
              <Check size={16} className="mt-0.5 shrink-0" aria-hidden />
              {t("offers.valid_summary", {
                name: parsed.offer.vendor_name,
                total: formatMoney(
                  parsed.offer.line_items.length || parsed.offer.stated_total === null
                    ? offerTotalAt(parsed.offer, parsed.offer.guest_count)
                    : parsed.offer.stated_total,
                  parsed.offer.currency,
                  locale,
                ),
                date: formatDate(parsed.offer.quoted_at, locale),
              })}
            </p>
            <label className="block text-xs">
              <span className="mb-1 block font-medium">{t("offers.step3_title")}</span>
              <select
                value={supplierId}
                onChange={(e) => setLink(e.target.value)}
                aria-label={t("offers.vendor_link")}
                className="input w-full"
              >
                <option value="">{t("offers.vendor_other")}</option>
                {threads.map((th) => (
                  <option key={th.booking_id} value={th.supplier_id}>
                    {th.vendor_name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className="inline-flex h-9 items-center rounded-full bg-ink-900 px-5 text-sm font-semibold text-white disabled:opacity-50 dark:bg-paper-50 dark:text-ink-900"
            >
              {t("offers.save")}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
