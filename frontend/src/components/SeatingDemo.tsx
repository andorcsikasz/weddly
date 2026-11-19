/**
 * Interactive seating demo for the landing page.
 *
 * It plays itself while on screen (a table is added, a guest is seated, a
 * conflict is flagged and fixed, someone is swapped out, the plan prints) and
 * hands control to the visitor on their first tap: from then on a table opens
 * a panel listing who sits there, a name can be unseated or picked as the one
 * to replace, and a guest from the "unseated" tray takes a free seat or swaps
 * in. Nothing is saved; it is a toy that behaves like the real canvas.
 *
 * Drawn in HTML over a fixed 480 x 360 frame rather than as an SVG so every
 * table and name is a real button. Sizes scale with the frame through
 * container query units (`u()`), so the layout is identical at any width.
 * The frame stays light in dark mode, like a screenshot of the app would.
 */
import { X } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../lib/i18n";

/** Frame units → container width. 480 units = 100cqw. */
const u = (n: number) => `${(n / 4.8).toFixed(3)}cqw`;
/** Readable floor for small text on phones. */
const fs = (n: number, minPx: number) => `max(${minPx}px, ${u(n)})`;

type TableId = "family" | "friends" | "plusOnes" | "work" | "uni" | "t6";
type Seats = Record<TableId, (string | null)[]>;
type Pt = { x: number; y: number };

const TABLES: { id: TableId; x: number; y: number; labelKey?: string }[] = [
  { id: "family", x: 110, y: 150, labelKey: "landing.mockup_table_family" },
  { id: "friends", x: 220, y: 132, labelKey: "landing.mockup_table_friends" },
  { id: "plusOnes", x: 330, y: 150, labelKey: "landing.mockup_table_plus_ones" },
  { id: "work", x: 160, y: 236, labelKey: "landing.mockup_table_work" },
  { id: "uni", x: 280, y: 236, labelKey: "landing.mockup_table_uni" },
  { id: "t6", x: 412, y: 66 },
];
const SEAT_DEGS = [270, 330, 30, 90, 150, 210] as const;
const SEAT_R = 27;
const TABLE_D = 44;

/** Two guests who must not share a table. */
const CONFLICTS: [string, string][] = [["Bence K.", "Réka H."]];

const initialSeats = (): Seats => ({
  family: ["Anna T.", "Réka H.", "Gabi T.", "Zoli T.", null, null],
  friends: ["Kata B.", "Peti S.", "Nóri V.", "Ádám F.", null, null],
  plusOnes: ["Eszter M.", "Tomi M.", "Luca P.", null, null, null],
  work: ["Marci S.", "Juli K.", "Bálint O.", "Vera L.", "Zsófi N.", "Dani R."],
  uni: ["Nina P.", "Ákos B.", "Fanni D.", "Levi G.", null, null],
  t6: [null, null, null, null, null, null],
});
const INITIAL_TRAY = ["Dóra N.", "Bence K.", "Lili S."];

const FLIGHT_MS = 420;
/** Bearings (degrees) of the droplets thrown out on each click. */
const SHOWER = [0, 45, 90, 135, 180, 225, 270, 315] as const;
const TRAY_Y = 318;
const chipPos = (i: number): Pt => ({ x: 24 + 36 + i * 78, y: TRAY_Y });
const tableOf = (id: TableId) => TABLES.find((t) => t.id === id)!;
const seatPos = (id: TableId, i: number): Pt => {
  const t = tableOf(id);
  const rad = ((SEAT_DEGS[i] ?? 0) * Math.PI) / 180;
  return { x: t.x + Math.cos(rad) * SEAT_R, y: t.y + Math.sin(rad) * SEAT_R };
};

/** Panel geometry, shared by the render and the autoplay cursor. */
const PANEL_W = 136;
const PANEL_ROW = 17;
const PANEL_H = 30 + 6 * PANEL_ROW + 30;
function panelBox(id: TableId): Pt {
  const t = tableOf(id);
  const x = t.x < 250 ? t.x + 38 : t.x - 38 - PANEL_W;
  const y = Math.min(Math.max(t.y - 40, 22), 344 - PANEL_H - 4);
  return { x, y };
}
const panelRowPos = (id: TableId, i: number): Pt => {
  const p = panelBox(id);
  return { x: p.x + PANEL_W / 2, y: p.y + 30 + i * PANEL_ROW + PANEL_ROW / 2 };
};

type Flight = { name: string; from: Pt; to: Pt; go: boolean } | null;

class Cancelled extends Error {}

export function SeatingDemo({ className }: { className?: string }) {
  const { t } = useT();
  const [seats, setSeats] = useState<Seats>(initialSeats);
  const [tray, setTray] = useState<string[]>(INITIAL_TRAY);
  const [showT6, setShowT6] = useState(false);
  const [selected, setSelected] = useState<TableId | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [flight, setFlight] = useState<Flight>(null);
  const [pulse, setPulse] = useState<{ id: TableId; n: number } | null>(null);
  const [toast, setToast] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [cursor, setCursor] = useState<(Pt & { click: number }) | null>(null);
  const [live, setLive] = useState(false); // visitor has taken over

  // Async autoplay reads the latest state through refs.
  const seatsRef = useRef(seats);
  const trayRef = useRef(tray);
  seatsRef.current = seats;
  trayRef.current = tray;
  const rootRef = useRef<HTMLDivElement>(null);
  const tokenRef = useRef<{ cancelled: boolean } | null>(null);
  const liveRef = useRef(false);
  const genRef = useRef(0);

  const conflictAt = useMemo(() => {
    const out = new Set<TableId>();
    for (const tb of TABLES) {
      const names = seats[tb.id];
      if (CONFLICTS.some(([a, b]) => names.includes(a) && names.includes(b))) out.add(tb.id);
    }
    return out;
  }, [seats]);

  /** Fly `name` from wherever it is to `to` (a table seat, or back to the
   *  tray when `to` is null). A seat that is taken sends its occupant to the
   *  tray, which is what "replace" means. */
  const moveGuest = useCallback(
    (name: string, to: { table: TableId; seat?: number } | null): Promise<void> => {
      const s = seatsRef.current;
      const tr = trayRef.current;
      let from: Pt | null = null;
      const nextSeats: Seats = {
        family: [...s.family],
        friends: [...s.friends],
        plusOnes: [...s.plusOnes],
        work: [...s.work],
        uni: [...s.uni],
        t6: [...s.t6],
      };
      let nextTray = [...tr];
      const ti = tr.indexOf(name);
      if (ti >= 0) {
        from = chipPos(ti);
        nextTray.splice(ti, 1);
      } else {
        for (const tb of TABLES) {
          const i = nextSeats[tb.id].indexOf(name);
          if (i >= 0) {
            from = seatPos(tb.id, i);
            nextSeats[tb.id][i] = null;
          }
        }
      }
      if (!from) return Promise.resolve();

      let dest: Pt;
      let land: () => void;
      if (to) {
        const row = nextSeats[to.table];
        const seat = to.seat ?? row.indexOf(null);
        if (seat < 0) return Promise.resolve();
        dest = seatPos(to.table, seat);
        const bumped = row[seat];
        if (bumped) {
          nextTray = [...nextTray, bumped];
          row[seat] = null;
        }
        land = () => {
          const cur = seatsRef.current;
          const done = { ...cur, [to.table]: cur[to.table].map((g, i) => (i === seat ? name : g)) };
          seatsRef.current = done;
          setSeats(done);
          setPulse({ id: to.table, n: Date.now() });
        };
      } else {
        dest = chipPos(nextTray.length);
        land = () => {
          const done = [...trayRef.current, name];
          trayRef.current = done;
          setTray(done);
        };
      }
      // Lift the guest out of its origin straight away; the card carries it.
      setSeats(nextSeats);
      setTray(nextTray);
      seatsRef.current = nextSeats;
      trayRef.current = nextTray;
      setFlight({ name, from, to: dest, go: false });
      requestAnimationFrame(() =>
        requestAnimationFrame(() => setFlight((f) => (f ? { ...f, go: true } : f))),
      );
      const gen = genRef.current;
      return new Promise((res) =>
        setTimeout(() => {
          // A reset while this guest was in the air voids the landing.
          if (gen === genRef.current) {
            land();
            setFlight(null);
          }
          res();
        }, FLIGHT_MS),
      );
    },
    [],
  );

  const reset = useCallback(() => {
    genRef.current += 1;
    const s = initialSeats();
    setSeats(s);
    seatsRef.current = s;
    setTray(INITIAL_TRAY);
    trayRef.current = INITIAL_TRAY;
    setShowT6(false);
    setSelected(null);
    setTarget(null);
    setPicked(null);
    setFlight(null);
    setToast(false);
    setNote(null);
  }, []);

  // ── Autoplay ─────────────────────────────────────────────────────────
  const runScript = useCallback(
    async (tok: { cancelled: boolean }) => {
      const wait = (ms: number) =>
        new Promise<void>((res, rej) =>
          setTimeout(() => (tok.cancelled ? rej(new Cancelled()) : res()), ms),
        );
      const go = async (p: Pt, ms = 380) => {
        setCursor((c) => ({ ...p, click: c?.click ?? 0 }));
        await wait(ms);
      };
      const click = async () => {
        setCursor((c) => (c ? { ...c, click: c.click + 1 } : c));
        await wait(140);
      };
      const step = async (p: Promise<void>) => {
        await p;
        if (tok.cancelled) throw new Cancelled();
      };
      try {
        while (!tok.cancelled) {
          reset();
          setCursor({ x: 300, y: 300, click: 0 });
          await wait(450);
          // 1. A sixth table
          await go({ x: 412, y: 66 });
          await click();
          setShowT6(true);
          setPulse({ id: "t6", n: Date.now() });
          await wait(380);
          // 2. Dóra to the plus-ones table
          await go(chipPos(0));
          await click();
          setPicked("Dóra N.");
          await go({ x: 330, y: 150 }, 260);
          await click();
          setPicked(null);
          await step(moveGuest("Dóra N.", { table: "plusOnes" }));
          await wait(250);
          // 3. Open the family table: see who sits there
          await go({ x: 110, y: 150 });
          await click();
          setSelected("family");
          await wait(900);
          // 4. Bence lands next to Réka: conflict
          await go(chipPos(0));
          await click();
          setPicked("Bence K.");
          await go({ x: 110, y: 150 }, 260);
          await click();
          setPicked(null);
          await step(moveGuest("Bence K.", { table: "family" }));
          await wait(1100);
          // 5. Move him to the friends table
          await go(seatPos("family", 4), 300);
          await click();
          setSelected("friends");
          await go({ x: 220, y: 132 }, 200);
          await step(moveGuest("Bence K.", { table: "friends" }));
          await wait(700);
          // 6. Work table is full: replace Marci with Lili
          await go({ x: 160, y: 236 });
          await click();
          setSelected("work");
          await wait(500);
          await go(panelRowPos("work", 0));
          await click();
          setTarget(0);
          await wait(350);
          await go(chipPos(0));
          await click();
          await step(moveGuest("Lili S.", { table: "work", seat: 0 }));
          setTarget(null);
          await wait(700);
          // 7. Print
          setSelected(null);
          await go({ x: 404, y: TRAY_Y });
          setToast(true);
          await wait(1500);
          setToast(false);
          await wait(300);
        }
      } catch (e) {
        if (!(e instanceof Cancelled)) throw e;
      }
    },
    [moveGuest, reset],
  );

  const stopAutoplay = useCallback(() => {
    if (tokenRef.current) tokenRef.current.cancelled = true;
    tokenRef.current = null;
    setCursor(null);
  }, []);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    if (!("IntersectionObserver" in window)) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (liveRef.current) return;
        if (entry?.isIntersecting && !tokenRef.current) {
          const tok = { cancelled: false };
          tokenRef.current = tok;
          void runScript(tok);
        } else if (!entry?.isIntersecting && tokenRef.current) {
          stopAutoplay();
        }
      },
      { threshold: 0.35 },
    );
    obs.observe(el);
    return () => {
      obs.disconnect();
      stopAutoplay();
    };
  }, [runScript, stopAutoplay]);

  /** First real tap: the visitor drives from here. The scene is reset so
   *  they start from a clean, settled plan rather than mid-flight. */
  const takeOver = (e: React.PointerEvent) => {
    if (!e.isTrusted || liveRef.current) return;
    liveRef.current = true;
    setLive(true);
    stopAutoplay();
    reset();
    setShowT6(true);
  };

  // ── Visitor actions ──────────────────────────────────────────────────
  const flash = (msg: string) => {
    setNote(msg);
    window.setTimeout(() => setNote((n) => (n === msg ? null : n)), 1800);
  };
  const seatInto = (name: string, table: TableId) => {
    const row = seatsRef.current[table];
    const seat = target ?? row.indexOf(null);
    if (seat < 0) {
      setSelected(table);
      flash(t("landing.seating_demo_full"));
      return;
    }
    setPicked(null);
    setTarget(null);
    void moveGuest(name, { table, seat });
  };
  const onTable = (id: TableId) => {
    if (!live || flight) return;
    if (picked) {
      setSelected(id);
      seatInto(picked, id);
      return;
    }
    setTarget(null);
    setSelected((s) => (s === id ? null : id));
  };
  const onChip = (name: string) => {
    if (!live || flight) return;
    if (selected) seatInto(name, selected);
    else setPicked((p) => (p === name ? null : name));
  };
  const onRow = (i: number) => {
    if (!live || flight || !selected) return;
    if (picked) {
      setTarget(i);
      const name = picked;
      setPicked(null);
      void moveGuest(name, { table: selected, seat: i }).then(() => setTarget(null));
      return;
    }
    setTarget((x) => (x === i ? null : i));
  };
  const onUnseat = (i: number) => {
    if (!live || flight || !selected) return;
    const name = seatsRef.current[selected][i];
    if (name) {
      setTarget(null);
      void moveGuest(name, null);
    }
  };

  const label = (tb: (typeof TABLES)[number]) => (tb.labelKey ? t(tb.labelKey) : "6");
  const visibleTables = TABLES.filter((tb) => tb.id !== "t6" || showT6);
  const at = (p: Pt) => ({ left: u(p.x), top: u(p.y) });

  return (
    <div className={className}>
      <div
        ref={rootRef}
        role="group"
        aria-label={t("landing.mockup_aria_seating")}
        onPointerDownCapture={takeOver}
        className="seating-demo relative w-full select-none overflow-hidden border border-paper-200 bg-white font-sans text-ink-800"
        style={{ containerType: "inline-size", aspectRatio: "480 / 360", borderRadius: u(16) }}
      >
        {/* Floor with a dashed grid; tapping it closes whatever is open. */}
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => {
            if (!live) return;
            setSelected(null);
            setPicked(null);
            setTarget(null);
          }}
          className="absolute cursor-default bg-paper-100"
          style={{
            left: u(16),
            top: u(16),
            width: u(448),
            height: u(328),
            borderRadius: u(8),
          }}
        >
          <svg
            viewBox="16 16 448 328"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full text-paper-300"
            aria-hidden="true"
          >
            {[48, 112, 176, 240, 304].map((y) => (
              <line
                key={`h${y}`}
                x1="16"
                x2="464"
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeWidth="0.5"
                strokeDasharray="2 4"
              />
            ))}
            {[80, 168, 256, 344, 432].map((x) => (
              <line
                key={`v${x}`}
                x1={x}
                x2={x}
                y1="16"
                y2="344"
                stroke="currentColor"
                strokeWidth="0.5"
                strokeDasharray="2 4"
              />
            ))}
          </svg>
        </button>

        {/* Hint */}
        <p
          className="pointer-events-none absolute text-ink-500"
          style={{
            left: u(26),
            top: u(24),
            fontSize: fs(7.5, 8),
            maxWidth: u(130),
            lineHeight: 1.2,
          }}
        >
          {t("landing.seating_demo_hint")}
        </p>

        {/* Head table (decorative, the couple is always seated) */}
        <div
          aria-hidden="true"
          className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center border border-ink-700 bg-paper-50 font-semibold text-umber-600"
          style={{
            ...at({ x: 220, y: 44 }),
            width: u(100),
            height: u(22),
            borderRadius: u(4),
            fontSize: fs(9, 7),
          }}
        >
          {t("landing.mockup_table_head")}
          {[-32, -16, 0, 16, 32].map((dx) => (
            <span
              key={dx}
              className="absolute bg-umber-700"
              style={{
                left: `calc(50% + ${u(dx - 3)})`,
                top: u(-8),
                width: u(6),
                height: u(6),
                borderRadius: u(1.5),
              }}
            />
          ))}
        </div>

        {/* Tables */}
        {visibleTables.map((tb) => {
          const row = seats[tb.id];
          const conflict = conflictAt.has(tb.id);
          const isSel = selected === tb.id;
          const filled = row.filter(Boolean).length;
          return (
            <div key={tb.id} className={tb.id === "t6" ? "seating-pop" : undefined}>
              {/* Seats */}
              {row.map((g, i) => {
                const p = seatPos(tb.id, i);
                return (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: seats are positional
                    key={i}
                    aria-hidden="true"
                    className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 transition-colors duration-300 ${
                      g ? "bg-umber-700" : "bg-umber-300/70"
                    } ${isSel && target === i ? "ring-2 ring-umber-900 ring-offset-1" : ""}`}
                    style={{
                      ...at(p),
                      width: u(8),
                      height: u(6),
                      borderRadius: u(1.5),
                      rotate: `${(SEAT_DEGS[i] ?? 0) + 90}deg`,
                    }}
                  />
                );
              })}
              {pulse?.id === tb.id && (
                <span
                  key={pulse.n}
                  aria-hidden="true"
                  className="seating-pulse pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-umber-600"
                  style={{ ...at(tb), width: u(64), height: u(64) }}
                />
              )}
              {conflict && (
                <span
                  aria-hidden="true"
                  className="seating-pop pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-amber-500"
                  style={{ ...at(tb), width: u(66), height: u(66) }}
                />
              )}
              <button
                type="button"
                onClick={() => onTable(tb.id)}
                aria-label={`${label(tb)} · ${filled}/6`}
                aria-expanded={isSel}
                className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border bg-paper-50 text-center font-semibold leading-tight text-umber-600 transition-[box-shadow,transform] duration-200 ${
                  isSel ? "scale-110 border-umber-900 shadow-lg" : "border-ink-700"
                } ${live ? "cursor-pointer hover:scale-105" : ""}`}
                style={{
                  ...at(tb),
                  width: u(TABLE_D),
                  height: u(TABLE_D),
                  fontSize: fs(7.5, 6),
                  padding: u(3),
                }}
              >
                {label(tb)}
              </button>
              {conflict && (
                <span
                  title={t("landing.seating_demo_conflict")}
                  className="seating-pop absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-amber-500 font-bold text-white"
                  style={{
                    ...at({ x: tb.x + 24, y: tb.y - 24 }),
                    width: u(16),
                    height: u(16),
                    fontSize: fs(10, 8),
                  }}
                >
                  !
                </span>
              )}
            </div>
          );
        })}

        {/* Unseated tray */}
        <p
          className="pointer-events-none absolute font-semibold uppercase tracking-wider text-ink-500"
          style={{ left: u(26), top: u(TRAY_Y - 24), fontSize: fs(6.5, 7) }}
        >
          {t("landing.seating_demo_unseated")}
        </p>
        {tray.map((name, i) => (
          <button
            key={name}
            type="button"
            onClick={() => onChip(name)}
            className={`seating-pop absolute flex -translate-x-1/2 -translate-y-1/2 items-center border bg-white font-semibold text-ink-800 transition-[left,top,box-shadow] duration-300 ${
              picked === name ? "border-umber-900 shadow-lg" : "border-paper-300 shadow-sm"
            } ${live ? "cursor-pointer hover:border-umber-600" : ""}`}
            style={{
              ...at({ x: chipPos(i).x, y: TRAY_Y - (picked === name ? 5 : 0) }),
              width: u(72),
              height: u(24),
              gap: u(5),
              paddingLeft: u(6),
              borderRadius: u(6),
              fontSize: fs(8.5, 8),
            }}
          >
            <span
              aria-hidden="true"
              className="shrink-0 rounded-full bg-umber-300"
              style={{ width: u(10), height: u(10) }}
            />
            <span className="truncate">{name}</span>
          </button>
        ))}

        {/* Table panel: who sits here */}
        {selected &&
          (() => {
            const tb = tableOf(selected);
            const box = panelBox(selected);
            const row = seats[selected];
            const conflict = conflictAt.has(selected);
            const bad = new Set(CONFLICTS.flat());
            return (
              <div
                key={selected}
                className="seating-panel absolute z-10 border border-paper-300 bg-white shadow-xl"
                style={{
                  left: u(box.x),
                  top: u(box.y),
                  width: u(PANEL_W),
                  borderRadius: u(8),
                  padding: `${u(6)} ${u(8)}`,
                }}
              >
                <div className="flex items-center justify-between" style={{ height: u(20) }}>
                  <span className="font-semibold text-ink-900" style={{ fontSize: fs(9.5, 9) }}>
                    {label(tb)}{" "}
                    <span className="font-normal text-ink-500">{row.filter(Boolean).length}/6</span>
                  </span>
                  <button
                    type="button"
                    aria-label={t("landing.seating_demo_close")}
                    onClick={() => {
                      setSelected(null);
                      setTarget(null);
                    }}
                    className="text-ink-500 hover:text-ink-900"
                  >
                    <X style={{ width: fs(10, 10), height: fs(10, 10) }} strokeWidth={2} />
                  </button>
                </div>
                <ul style={{ marginTop: u(2) }}>
                  {row.map((g, i) => (
                    <li
                      // biome-ignore lint/suspicious/noArrayIndexKey: seats are positional
                      key={i}
                      className={`flex items-center justify-between transition-colors ${
                        target === i ? "bg-paper-200" : ""
                      }`}
                      style={{ height: u(PANEL_ROW), borderRadius: u(4), paddingInline: u(4) }}
                    >
                      <button
                        type="button"
                        onClick={() => onRow(i)}
                        className={`min-w-0 flex-1 truncate text-left ${
                          g
                            ? conflict && bad.has(g)
                              ? "font-semibold text-amber-600"
                              : "text-ink-800"
                            : " text-ink-500/70"
                        }`}
                        style={{ fontSize: fs(8.5, 9) }}
                      >
                        {g ?? t("landing.seating_demo_empty")}
                        {target === i && (
                          <span className="ml-1 font-semibold text-umber-700">
                            · {t("landing.seating_demo_replace")}
                          </span>
                        )}
                      </button>
                      {g && (
                        <button
                          type="button"
                          aria-label={t("landing.seating_demo_unseat", { name: g })}
                          onClick={() => onUnseat(i)}
                          className="shrink-0 text-ink-500 hover:text-ink-900"
                        >
                          <X style={{ width: fs(8, 9), height: fs(8, 9) }} strokeWidth={2} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                <p
                  className={conflict || note ? "font-semibold text-amber-600" : "text-ink-500"}
                  style={{ fontSize: fs(7, 8), marginTop: u(4), lineHeight: 1.25 }}
                >
                  {note ??
                    (conflict
                      ? `! ${CONFLICTS[0]!.join(" & ")}: ${t("landing.seating_demo_conflict")}`
                      : tray.length > 0
                        ? t("landing.seating_demo_swap_hint")
                        : "")}
                </p>
              </div>
            );
          })()}

        {/* A guest in the air */}
        {flight && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-20 flex -translate-x-1/2 -translate-y-1/2 items-center border border-umber-900 bg-white font-semibold text-ink-800 shadow-xl"
            style={{
              ...at(flight.go ? flight.to : flight.from),
              width: u(72),
              height: u(24),
              gap: u(5),
              paddingLeft: u(6),
              borderRadius: u(6),
              fontSize: fs(8.5, 8),
              scale: flight.go ? "0.55" : "1.08",
              transition: `left ${FLIGHT_MS}ms cubic-bezier(.5,0,.2,1), top ${FLIGHT_MS}ms cubic-bezier(.5,0,.2,1), scale ${FLIGHT_MS}ms ease-in`,
            }}
          >
            <span
              className="shrink-0 rounded-full bg-umber-300"
              style={{ width: u(10), height: u(10) }}
            />
            <span className="truncate">{flight.name}</span>
          </div>
        )}

        {/* Print toast */}
        {toast && (
          <div
            aria-hidden="true"
            className="seating-pop absolute z-20 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center bg-umber-800 font-semibold text-white"
            style={{
              ...at({ x: 404, y: TRAY_Y }),
              height: u(24),
              paddingInline: u(12),
              borderRadius: u(12),
              fontSize: fs(9, 8),
              whiteSpace: "nowrap",
            }}
          >
            {t("landing.seating_demo_print")} ✓
          </div>
        )}

        {/* Autoplay pointer */}
        {cursor && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-30"
            style={{
              ...at(cursor),
              transition:
                "left 340ms cubic-bezier(.45,0,.25,1), top 340ms cubic-bezier(.45,0,.25,1)",
            }}
          >
            {/* The ring and the droplets are centred on the origin, which is
                exactly the arrow's tip (the path below starts at 0,0). Anchoring
                on the tip means the click reads as coming from the pointer. */}
            <span
              key={cursor.click}
              className={cursor.click ? "seating-click absolute rounded-full bg-umber-900/25" : ""}
              style={{ left: u(-9), top: u(-9), width: u(18), height: u(18) }}
            />
            {cursor.click > 0 && (
              <span
                key={cursor.click}
                aria-hidden="true"
                className="absolute"
                style={{ left: 0, top: 0, width: 0, height: 0 }}
              >
                {SHOWER.map((a, i) => (
                  <span
                    key={a}
                    className="seating-shower absolute rounded-full bg-umber-800"
                    style={
                      {
                        left: u(-1.4),
                        top: u(-1.4),
                        width: u(2.8),
                        height: u(2.8),
                        "--a": `${a}deg`,
                        "--dist": u(i % 2 === 0 ? 16 : 25),
                      } as CSSProperties
                    }
                  />
                ))}
              </span>
            )}
            <svg
              viewBox="0 0 14 20"
              style={{ width: u(11), height: u(16) }}
              className="relative overflow-visible text-ink-900"
            >
              <path
                d="M 0 0 L 0 15 L 4 11 L 7 18 L 10 17 L 7 10 L 12 10 Z"
                fill="currentColor"
                stroke="white"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}

export default SeatingDemo;
