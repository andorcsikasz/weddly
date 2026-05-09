// Seating page. Two surfaces stacked vertically:
//   1. Floor-plan map at the top — drag tables to position, click to select,
//      edit shape/seats/dimensions in the inline editor panel.
//   2. The seat-assignment grid below — drag guests onto specific seats.
// We trade pixel-perfect placement on the assignment grid for an approachable
// column layout; the map is where pixel-perfect (millimetre) layout lives,
// and that's what the PDF export consumes.

import type { Guest, SeatAssignment, SeatingTable, TableShape } from "@shared/types";
import { ChefHat, Plus, Printer, Trash2 } from "lucide-react";
import { type DragEvent, useEffect, useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { useConfirm, useEntryPrompt } from "../components/ui";
import { fetchPdfBlob, guestApi, seatingApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { ROOM_DIMS, SeatingMap } from "./seating/SeatingMap";

const SHAPES: TableShape[] = ["round", "long", "square"];

interface DragData {
  guestId: number;
}

export default function SeatingPage() {
  const { t } = useT();
  const confirm = useConfirm();
  const promptEntry = useEntryPrompt();
  const [tables, setTables] = useState<SeatingTable[]>([]);
  const [assignments, setAssignments] = useState<SeatAssignment[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);

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
  const selected = useMemo(
    () => tables.find((tb) => tb.id === selectedId) ?? null,
    [tables, selectedId],
  );

  async function addTable() {
    const label = await promptEntry({
      title: t("seating.add_table"),
      label: t("seating.table_label_prompt"),
      defaultValue: `${t("nav.seating")} ${tables.length + 1}`,
      confirmLabel: t("common.save"),
      cancelLabel: t("common.cancel"),
      validate: (v) => (v.trim().length === 0 ? t("seating.table_label_prompt") : null),
    });
    if (!label) return;
    // Drop new tables near the centre of the room with a small per-table
    // offset so consecutive adds don't stack on top of each other.
    const offset = (tables.length % 5) * 800;
    const res = await seatingApi.createTable({
      label,
      shape: "round",
      seats: 8,
      x_mm: ROOM_DIMS.W_MM / 2 + offset - 1600,
      y_mm: ROOM_DIMS.H_MM / 2,
      width_mm: 1500,
      length_mm: 1500,
    });
    setSelectedId(res.table.id);
    refresh();
  }

  async function deleteTable(table: SeatingTable) {
    const ok = await confirm({
      title: t("seating.confirm_delete_table"),
      body: table.label,
      confirmLabel: t("common.confirm_delete"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    await seatingApi.removeTable(table.id);
    if (selectedId === table.id) setSelectedId(null);
    refresh();
  }

  async function patchTable(table: SeatingTable, patch: Partial<SeatingTable>) {
    // Server PATCH expects all the editable fields, so always send a merged
    // payload. Defaults to existing values for anything the caller omitted.
    await seatingApi.updateTable(table.id, { ...table, ...patch });
    refresh();
  }

  async function moveTable(id: number, x_mm: number, y_mm: number) {
    const table = tables.find((tb) => tb.id === id);
    if (!table) return;
    await patchTable(table, { x_mm, y_mm });
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

      {tables.length === 0 ? (
        <div className="card stationery text-center">
          <ChefHat size={28} className="mx-auto text-ink-500" />
          <h3 className="mt-3 text-base font-semibold">{t("seating.no_tables")}</h3>
          <p className="mt-1 text-sm text-ink-600">{t("seating.add_first_table")}</p>
        </div>
      ) : (
        <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_320px]">
          <SeatingMap
            tables={tables}
            assignments={assignments}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onMove={moveTable}
          />
          <TableEditor
            table={selected}
            onPatch={(patch) => selected && patchTable(selected, patch)}
            onDelete={() => selected && deleteTable(selected)}
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div>
          {tables.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              {tables.map((table) => (
                <TableCard
                  key={table.id}
                  table={table}
                  assignments={assignments.filter((a) => a.table_id === table.id)}
                  guestById={guestById}
                  onDropSeat={dropToSeat}
                  onSelect={() => setSelectedId(table.id)}
                  isSelected={selectedId === table.id}
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

function TableEditor({
  table,
  onPatch,
  onDelete,
}: {
  table: SeatingTable | null;
  onPatch: (patch: Partial<SeatingTable>) => void;
  onDelete: () => void;
}) {
  const { t } = useT();

  if (!table) {
    return (
      <div className="card text-sm text-ink-500">
        <p>{t("seating.editor_empty")}</p>
      </div>
    );
  }

  // For round and square the two dimensions are kept in lockstep server-side,
  // so the UI hides the length input and shows a single "size" control.
  const isLong = table.shape === "long";

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-serif text-xl">{table.label}</h3>
        <button
          type="button"
          className="btn-ghost btn-sm text-blush-700"
          onClick={onDelete}
          aria-label={t("seating.delete_table")}
        >
          <Trash2 size={14} />
        </button>
      </div>

      <Field label={t("seating.table_label_prompt")}>
        <input
          type="text"
          className="input py-1.5 text-sm"
          defaultValue={table.label}
          key={`${table.id}-label`}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v && v !== table.label) onPatch({ label: v });
          }}
        />
      </Field>

      <Field label={t("seating.shape_label")}>
        <select
          className="input py-1.5 text-sm"
          value={table.shape}
          onChange={(e) => onPatch({ shape: e.target.value as TableShape })}
        >
          {SHAPES.map((s) => (
            <option key={s} value={s}>
              {t(`seating.shape_${s}`)}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t("seating.seats_label")}>
        <input
          type="number"
          min={1}
          max={40}
          className="input py-1.5 text-sm"
          defaultValue={table.seats}
          key={`${table.id}-seats`}
          onBlur={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n) && n >= 1 && n <= 40 && n !== table.seats) {
              onPatch({ seats: Math.round(n) });
            }
          }}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={isLong ? t("seating.length_mm_label") : t("seating.size_mm_label")} hint="mm">
          <input
            type="number"
            min={100}
            max={10000}
            step={50}
            className="input py-1.5 text-sm"
            defaultValue={isLong ? table.length_mm : table.width_mm}
            key={`${table.id}-primary`}
            onBlur={(e) => {
              const n = Number(e.target.value);
              if (!Number.isFinite(n) || n < 100 || n > 10000) return;
              const rounded = Math.round(n);
              if (isLong) {
                if (rounded !== table.length_mm) onPatch({ length_mm: rounded });
              } else {
                // Round/square keep both dimensions equal.
                if (rounded !== table.width_mm) {
                  onPatch({ width_mm: rounded, length_mm: rounded });
                }
              }
            }}
          />
        </Field>

        {isLong && (
          <Field label={t("seating.width_mm_label")} hint="mm">
            <input
              type="number"
              min={100}
              max={10000}
              step={50}
              className="input py-1.5 text-sm"
              defaultValue={table.width_mm}
              key={`${table.id}-secondary`}
              onBlur={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n) || n < 100 || n > 10000) return;
                const rounded = Math.round(n);
                if (rounded !== table.width_mm) onPatch({ width_mm: rounded });
              }}
            />
          </Field>
        )}
      </div>

      <p className="text-xs text-ink-400">
        {t("seating.position_label")}: {table.x_mm} mm · {table.y_mm} mm
      </p>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-xs">
      <span className="mb-1 flex items-center justify-between text-ink-500">
        <span>{label}</span>
        {hint && <span className="text-ink-300">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function TableCard({
  table,
  assignments,
  guestById,
  onDropSeat,
  onSelect,
  isSelected,
}: {
  table: SeatingTable;
  assignments: SeatAssignment[];
  guestById: Map<number, Guest>;
  onDropSeat: (tableId: number, seatIndex: number, e: DragEvent) => void;
  onSelect: () => void;
  isSelected: boolean;
}) {
  const { t } = useT();
  const seatToAssign = new Map(assignments.map((a) => [a.seat_index, a]));

  return (
    <div
      className={`card cursor-pointer transition-shadow ${
        isSelected ? "ring-2 ring-blush-400" : "hover:shadow-pop"
      }`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-serif text-xl">{table.label}</h3>
          <p className="mt-0.5 text-xs text-ink-500">
            {t(`seating.shape_${table.shape}`)} · {table.seats} {t("seating.seats_label")}
          </p>
        </div>
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
      onClick={(e) => e.stopPropagation()}
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
