// Admin editor for the four public landing counters.
//
// Each row is one counter: the MEASURED number (counted from live rows this
// second), the display offset an admin has set, and their sum, which is
// literally what an anonymous visitor sees on the landing page. The eye toggle
// in that last column takes the counter off the public page altogether, which
// is a different answer from an offset of 0 (that still publishes the measured
// figure) and the right one while a number is too young to quote.
//
// The measured column is the reason this page is a table rather than four
// inputs. Once an offset is set, the landing page stops answering "how big is
// Weddly" and this becomes the only surface that still does, so the real
// figure has to sit beside the padded one where nobody can mistake which is
// which. Nothing else in admin reads the offsets: /app/admin/analytics, the
// financial planner and every campaign counter run their own queries.

import { Eye, EyeOff, RotateCcw, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { AdminPageHeader } from "../components/admin";
import { Button, Skeleton, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { adminPublicStatsApi } from "../lib/endpoints";
import { useDocumentMetaLiteral } from "../lib/seo";
import {
  type AdminPublicStatRow,
  type AdminPublicStatsPatch,
  MAX_STAT_BOOST,
  type PublicStatKey,
  PUBLIC_STAT_KEYS,
} from "@shared/public_stats";

type Loadable<T> = { status: "loading" } | { status: "ok"; data: T } | { status: "error" };

/** Row copy. `where` names the surface the number appears on, so an operator
 *  can tell at a glance which figure they are about to move. */
const LABELS: Record<PublicStatKey, { title: string; where: string; hiddenNote: string }> = {
  couples: {
    title: "Tervezgető pár",
    where: 'Nyitóoldal, "Live numbers" sáv. Aktív, onboardolt, nem demo workspace-ek.',
    hiddenNote:
      "Elrejtve a számláló eltűnik a sávból. Ha mindkettőt elrejted, a sáv sem jelenik meg.",
  },
  rsvps: {
    title: "Beérkezett RSVP",
    where:
      "Nyitóoldal, a pár-számláló mellett. Vendégek, akik igennel/nemmel/talánnal válaszoltak.",
    hiddenNote:
      "Elrejtve a számláló eltűnik a sávból. Ha mindkettőt elrejted, a sáv sem jelenik meg.",
  },
  vendors: {
    title: "Weddly Pro szolgáltató",
    where:
      "Nyitóoldal, founding sáv. Ebből számol vissza az 500-as helyszámláló, és ez a szám látszik a sávban is.",
    hiddenNote: "Elrejtve a nagy helyszámláló eltűnik; a sáv szövege és a gomb marad.",
  },
  listings: {
    title: "Katalógusban lévő cég",
    where:
      "Nyitóoldal, founding sáv második száma. Aktív listing-ek (curated + community + claimed).",
    hiddenNote: "Elrejtve a founding sáv alatti egysoros szám tűnik el.",
  },
};

/** Every counter shown, which is what a fresh page starts from. */
const NONE_HIDDEN: Record<PublicStatKey, boolean> = {
  couples: false,
  rsvps: false,
  vendors: false,
  listings: false,
};

export default function AdminPublicStatsPage() {
  useDocumentMetaLiteral(
    "Admin — Nyilvános számlálók",
    "Display offsets on the public landing counters.",
  );

  const toast = useToast();
  const [state, setState] = useState<Loadable<AdminPublicStatRow[]>>({ status: "loading" });
  // Raw digits per counter, kept as strings so an emptied field stays empty
  // while it is being retyped instead of snapping back to 0 under the cursor.
  const [draft, setDraft] = useState<Record<PublicStatKey, string>>({
    couples: "0",
    rsvps: "0",
    vendors: "0",
    listings: "0",
  });
  // Visibility is edited in the same draft-then-save rhythm as the offsets,
  // rather than writing on click: one Save for the whole table means an
  // operator can never be halfway through a change without knowing it.
  const [hiddenDraft, setHiddenDraft] = useState<Record<PublicStatKey, boolean>>(NONE_HIDDEN);
  const [saving, setSaving] = useState(false);

  function adopt(items: AdminPublicStatRow[]) {
    setState({ status: "ok", data: items });
    setDraft(
      Object.fromEntries(items.map((row) => [row.key, String(row.boost)])) as Record<
        PublicStatKey,
        string
      >,
    );
    setHiddenDraft(
      Object.fromEntries(items.map((row) => [row.key, row.hidden])) as Record<
        PublicStatKey,
        boolean
      >,
    );
  }

  useEffect(() => {
    let cancelled = false;
    adminPublicStatsApi
      .get()
      .then((res) => {
        if (!cancelled) adopt(res.items);
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = state.status === "ok" ? state.data : [];
  const dirty = rows.some(
    (row) => (draft[row.key] || "0") !== String(row.boost) || hiddenDraft[row.key] !== row.hidden,
  );

  async function save() {
    const patch: AdminPublicStatsPatch = { hidden: { ...hiddenDraft } };
    for (const key of PUBLIC_STAT_KEYS) {
      const parsed = Number.parseInt(draft[key] || "0", 10);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_STAT_BOOST) {
        toast.error(`${LABELS[key].title}: 0 és ${MAX_STAT_BOOST} közötti egész szám kell.`);
        return;
      }
      patch[key] = parsed;
    }
    setSaving(true);
    try {
      const res = await adminPublicStatsApi.update(patch);
      adopt(res.items);
      toast.success("Mentve. A nyitóoldal már az új számokat mutatja.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Nem sikerült menteni.");
    } finally {
      setSaving(false);
    }
  }

  function resetAll() {
    setDraft({ couples: "0", rsvps: "0", vendors: "0", listings: "0" });
  }

  return (
    <div className="space-y-6 px-4 sm:px-6 lg:px-8 xl:px-10">
      <AdminPageHeader
        title="Nyilvános számlálók"
        subtitle="A nyitóoldal négy száma. A bal oszlop a valós, élő adatokból számolt érték, a jobb oldali a látogató által látott szám. A kettő különbsége az itt beállított ráadás; nullázd, és a valós számok jönnek vissza. A szem ikonnal egy számláló teljesen leszedhető a nyitóoldalról."
      />

      {state.status === "loading" ? (
        <div className="space-y-2">
          {PUBLIC_STAT_KEYS.map((key) => (
            <Skeleton key={key} className="h-20 w-full" />
          ))}
        </div>
      ) : state.status === "error" ? (
        <p className="rounded-2xl border border-paper-300 bg-white p-6 text-sm text-neutral-600 dark:border-umber-700 dark:bg-umber-900 dark:text-umber-300">
          Nem sikerült betölteni. Frissítsd az oldalt.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-paper-300 dark:border-umber-700">
            <table className="min-w-full divide-y divide-paper-300 dark:divide-umber-700">
              <thead className="bg-paper-100 dark:bg-umber-800">
                <tr>
                  <Th>Számláló</Th>
                  <Th className="text-right">
                    <span className="inline-flex items-center gap-1.5">
                      <Users size={13} aria-hidden /> Valós
                    </span>
                  </Th>
                  <Th className="text-right">Ráadás</Th>
                  <Th className="text-right">
                    <span className="inline-flex items-center gap-1.5">
                      <Eye size={13} aria-hidden /> Látható
                    </span>
                  </Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-paper-200 bg-white dark:divide-umber-700 dark:bg-umber-900">
                {rows.map((row) => {
                  const typed = Number.parseInt(draft[row.key] || "0", 10);
                  const boost = Number.isFinite(typed) && typed >= 0 ? typed : 0;
                  const hidden = hiddenDraft[row.key];
                  return (
                    <tr key={row.key}>
                      <Td>
                        <div className="font-medium text-neutral-900 dark:text-paper-50">
                          {LABELS[row.key].title}
                        </div>
                        <div className="mt-0.5 max-w-md text-xs leading-snug text-neutral-500 dark:text-umber-300">
                          {hidden ? LABELS[row.key].hiddenNote : LABELS[row.key].where}
                        </div>
                      </Td>
                      <Td className="text-right tabular-nums text-neutral-600 dark:text-umber-300">
                        {row.real.toLocaleString("hu-HU")}
                      </Td>
                      <Td className="text-right">
                        <label className="sr-only" htmlFor={`boost-${row.key}`}>
                          {LABELS[row.key].title} ráadás
                        </label>
                        <div className="flex items-center justify-end gap-1">
                          <span className="text-neutral-400 dark:text-umber-400">+</span>
                          <input
                            id={`boost-${row.key}`}
                            type="text"
                            inputMode="numeric"
                            value={draft[row.key]}
                            onChange={(e) =>
                              setDraft((d) => ({
                                ...d,
                                // Digits only: the field is a whole count, and
                                // a stray minus would 400 on save rather than
                                // do anything useful.
                                [row.key]: e.target.value.replace(/[^\d]/g, ""),
                              }))
                            }
                            className="w-28 rounded-lg border border-paper-300 bg-white px-3 py-1.5 text-right text-sm tabular-nums text-neutral-900 focus:border-blush-400 focus:outline-none focus:ring-2 focus:ring-blush-200 dark:border-umber-600 dark:bg-umber-800 dark:text-paper-50"
                          />
                        </div>
                      </Td>
                      <Td className="text-right">
                        <div className="flex items-center justify-end gap-2.5">
                          <span
                            className={`text-base font-semibold tabular-nums ${
                              hidden
                                ? "text-neutral-400 line-through dark:text-umber-400"
                                : "text-neutral-900 dark:text-paper-50"
                            }`}
                          >
                            {(row.real + boost).toLocaleString("hu-HU")}
                          </span>
                          {/* The hide control. `aria-pressed` rather than a
                              checkbox: it is one button whose state is "this
                              counter is off the public page". */}
                          <button
                            type="button"
                            aria-pressed={hidden}
                            aria-label={
                              hidden
                                ? `${LABELS[row.key].title} megjelenítése a nyitóoldalon`
                                : `${LABELS[row.key].title} elrejtése a nyitóoldalról`
                            }
                            title={
                              hidden
                                ? "Elrejtve. Kattints, hogy újra látszódjon."
                                : "Elrejtés a nyitóoldalról"
                            }
                            onClick={() =>
                              setHiddenDraft((h) => ({ ...h, [row.key]: !h[row.key] }))
                            }
                            className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-blush-200 ${
                              hidden
                                ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                                : "border-paper-300 bg-white text-neutral-500 hover:bg-paper-100 dark:border-umber-600 dark:bg-umber-800 dark:text-umber-300 dark:hover:bg-umber-700"
                            }`}
                          >
                            {hidden ? (
                              <EyeOff size={15} aria-hidden />
                            ) : (
                              <Eye size={15} aria-hidden />
                            )}
                          </button>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={save} disabled={!dirty || saving}>
              {saving ? "Mentés…" : "Mentés"}
            </Button>
            <button
              type="button"
              onClick={resetAll}
              className="inline-flex items-center gap-1.5 text-sm text-neutral-600 underline-offset-4 hover:underline dark:text-umber-300"
            >
              <RotateCcw size={14} aria-hidden /> Mindet nullázom
            </button>
            {dirty && (
              <span className="text-xs text-neutral-500 dark:text-umber-300">
                Van nem mentett módosítás.
              </span>
            )}
          </div>

          <p className="max-w-2xl text-xs leading-relaxed text-neutral-500 dark:text-umber-300">
            A ráadás csak a nyilvános nyitóoldalt érinti. Az analitika, a pénzügyi tervező és a
            kampányok számai külön lekérdezésekből jönnek, azokat ez nem mozdítja el. A valós
            oszlopot semmi nem írja felül, így a nullázás mindig visszaadja a mért számokat. Az
            elrejtett számláló ki sem megy a szerverről (a nyilvános válaszban üres marad), tehát
            nem csak nem látszik: nincs is ott. Bármikor visszakapcsolható, semmi nem vész el.
          </p>
        </>
      )}
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-neutral-600 dark:text-umber-300 ${className}`}
    >
      {children}
    </th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`px-3 py-3 text-sm text-neutral-800 dark:text-paper-200 ${className}`}>
      {children}
    </td>
  );
}
