// Seating canvas. Tables as cards on a wrapped grid; drag guests onto seats.
// We trade pixel-perfect canvas placement for an approachable column layout —
// the PDF export still uses the underlying x_mm/y_mm if the user moves things.

import type { Guest, SeatAssignment, SeatingTable, TableShape } from "@shared/types";
import { ChefHat, Plus, Printer, Trash2 } from "lucide-react";
import { type DragEvent, useEffect, useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { fetchPdfBlob, guestApi, seatingApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

const SHAPES: TableShape[] = ["round", "long", "square"];

interface DragData {
  guestId: number;
}

export default function SeatingPage() {
  const { t } = useT();
  const [tables, setTables] = useState<SeatingTable[]>([]);
  const [assignments, setAssignments] = useState<SeatAssignment[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);

  async function refresh() {
    const [plan, gs] = await Promise.all([seatingApi.plan(), guestApi.list()]);
    setTables(plan.tables);
    setAssignments(plan.assignments);
    setGuests(gs.guests);
  }

  useEffect(() => {
    refresh();
  }, []);

  const guestById = useMemo(() => new Map(guests.map((g) => [g.id, g])), [guests]);
  const seatedIds = useMemo(() => new Set(assignments.map((a) => a.guest_id)), [assignments]);
  const unassigned = useMemo(() => guests.filter((g) => !seatedIds.has(g.id)), [guests, seatedIds]);

  async function addTable() {
    const label = prompt(
      t("seating.table_label_prompt"),
      `${t("nav.seating")} ${tables.length + 1}`,
    );
    if (!label?.trim()) return;
    await seatingApi.createTable({
      label: label.trim(),
      shape: "round",
      seats: 8,
      x_mm: 0,
      y_mm: 0,
    });
    refresh();
  }

  async function deleteTable(t: SeatingTable) {
    if (!confirm(`${t.label} — ${useT().t("seating.confirm_delete_table")}`)) return;
    await seatingApi.removeTable(t.id);
    refresh();
  }

  async function changeShape(table: SeatingTable, shape: TableShape) {
    await seatingApi.updateTable(table.id, { ...table, shape });
    refresh();
  }

  async function changeSeats(table: SeatingTable, seats: number) {
    if (!Number.isFinite(seats) || seats < 1 || seats > 40) return;
    await seatingApi.updateTable(table.id, { ...table, seats });
    refresh();
  }

  async function dropToSeat(tableId: number, seatIndex: number, e: DragEvent) {
    e.preventDefault();
    const data = readDragData(e);
    if (!data) return;
    await seatingApi.assign({ table_id: tableId, seat_index: seatIndex, guest_id: data.guestId });
    refresh();
  }

  async function dropToUnassigned(e: DragEvent) {
    e.preventDefault();
    const data = readDragData(e);
    if (!data) return;
    await seatingApi.unassign(data.guestId);
    refresh();
  }

  async function downloadPdf(path: string, name: string) {
    const blob = await fetchPdfBlob(path);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AppShell>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1>{t("seating.title")}</h1>
          <p className="mt-1 text-sm text-ink-500">{t("seating.sub")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-outline"
            onClick={() => downloadPdf("/api/print/seating/a4", "weddly-seating-a4.pdf")}
          >
            <Printer size={16} /> {t("seating.print_a4")}
          </button>
          <button
            type="button"
            className="btn-outline"
            onClick={() => downloadPdf("/api/print/seating/a3", "weddly-seating-a3.pdf")}
          >
            <Printer size={16} /> {t("seating.print_a3")}
          </button>
          <button
            type="button"
            className="btn-outline"
            onClick={() => downloadPdf("/api/print/place-cards", "weddly-place-cards.pdf")}
          >
            <Printer size={16} /> {t("seating.print_place_cards")}
          </button>
          <button type="button" className="btn-primary" onClick={addTable}>
            <Plus size={16} /> {t("seating.add_table")}
          </button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div>
          {tables.length === 0 ? (
            <div className="card stationery text-center">
              <ChefHat size={28} className="mx-auto text-ink-500" />
              <h3 className="mt-3 text-base font-semibold">{t("seating.no_tables")}</h3>
              <p className="mt-1 text-sm text-ink-600">{t("seating.add_first_table")}</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {tables.map((table) => (
                <TableCard
                  key={table.id}
                  table={table}
                  assignments={assignments.filter((a) => a.table_id === table.id)}
                  guestById={guestById}
                  onDropSeat={dropToSeat}
                  onDelete={() => deleteTable(table)}
                  onChangeShape={(s) => changeShape(table, s)}
                  onChangeSeats={(n) => changeSeats(table, n)}
                />
              ))}
            </div>
          )}
        </div>

        <aside
          className="card sticky top-20 self-start"
          onDragOver={(e) => e.preventDefault()}
          onDrop={dropToUnassigned}
        >
          <h2 className="text-lg">{t("seating.unassigned_guests")}</h2>
          <p className="mt-1 text-xs text-ink-500">{t("seating.drag_help")}</p>
          {unassigned.length === 0 ? (
            <p className="mt-4 text-sm text-ink-600">{t("seating.no_unassigned")}</p>
          ) : (
            <ul className="mt-3 max-h-[60vh] space-y-1 overflow-y-auto">
              {unassigned.map((g) => (
                <li key={g.id}>
                  <DraggableGuest guest={g} />
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </AppShell>
  );
}

function TableCard({
  table,
  assignments,
  guestById,
  onDropSeat,
  onDelete,
  onChangeShape,
  onChangeSeats,
}: {
  table: SeatingTable;
  assignments: SeatAssignment[];
  guestById: Map<number, Guest>;
  onDropSeat: (tableId: number, seatIndex: number, e: DragEvent) => void;
  onDelete: () => void;
  onChangeShape: (s: TableShape) => void;
  onChangeSeats: (n: number) => void;
}) {
  const { t } = useT();
  const seatToAssign = new Map(assignments.map((a) => [a.seat_index, a]));

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-serif text-xl">{table.label}</h3>
          <p className="mt-0.5 text-xs text-ink-500">
            {t(`seating.shape_${table.shape}`)} · {table.seats} {t("seating.seats_label")}
          </p>
        </div>
        <button
          type="button"
          className="btn-ghost btn-sm text-blush-700"
          onClick={onDelete}
          aria-label={t("seating.delete_table")}
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <select
          className="input input-sm py-1 text-xs"
          value={table.shape}
          onChange={(e) => onChangeShape(e.target.value as TableShape)}
          aria-label={t("seating.shape_label")}
        >
          {SHAPES.map((s) => (
            <option key={s} value={s}>
              {t(`seating.shape_${s}`)}
            </option>
          ))}
        </select>
        <input
          type="number"
          min={1}
          max={40}
          className="input py-1 text-xs w-20"
          defaultValue={table.seats}
          onBlur={(e) => onChangeSeats(Number(e.target.value))}
          aria-label={t("seating.seats_label")}
        />
      </div>

      <ol className="mt-4 grid grid-cols-2 gap-2">
        {Array.from({ length: table.seats }).map((_, idx) => {
          const a = seatToAssign.get(idx);
          const guest = a ? guestById.get(a.guest_id) : undefined;
          return (
            <li
              key={idx}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDropSeat(table.id, idx, e)}
              className={
                guest
                  ? "rounded-lg border border-ink-300 bg-paper-50 px-2 py-1.5 text-sm"
                  : "rounded-lg border border-dashed border-paper-300 bg-paper-100 px-2 py-1.5 text-xs text-ink-400"
              }
            >
              <span className="text-[10px] uppercase tracking-wider text-ink-400">#{idx + 1}</span>
              <div className="mt-0.5">
                {guest ? <DraggableGuest guest={guest} compact /> : <span>—</span>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function DraggableGuest({ guest, compact }: { guest: Guest; compact?: boolean }) {
  function onDragStart(e: DragEvent) {
    const data: DragData = { guestId: guest.id };
    e.dataTransfer.setData("application/x-weddly-guest", JSON.stringify(data));
    e.dataTransfer.effectAllowed = "move";
  }
  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={
        compact
          ? "cursor-grab text-sm font-medium text-ink-900 active:cursor-grabbing"
          : "cursor-grab rounded-lg border border-paper-300 bg-paper-50 px-2 py-1.5 text-sm text-ink-800 hover:border-ink-400 active:cursor-grabbing"
      }
    >
      {guest.full_name}
    </div>
  );
}

function readDragData(e: DragEvent): DragData | null {
  const raw = e.dataTransfer.getData("application/x-weddly-guest");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DragData;
  } catch {
    return null;
  }
}
