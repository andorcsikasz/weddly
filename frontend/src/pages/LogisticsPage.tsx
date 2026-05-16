// Logistics surface: accommodation + transfer assignment for the wedding's
// out-of-towners. Two tabs share one unassigned-guests sidebar (the active tab
// scopes "unassigned" to that dimension's foreign key on guests).
//
//   • Szállás: cards for each accommodation (name / address / capacity / price
//     / link / contact). Drag a guest from the sidebar onto a card to assign;
//     drag a chip back to the sidebar to free them up.
//   • Transzfer: flat editable table per the v1 spec — basic CRUD + a
//     guest-picker per row. Same drag-from-sidebar gesture works too so the
//     interaction stays consistent across both tabs.

import type {
  Accommodation,
  Guest,
  Transfer,
  UpsertAccommodationInput,
  UpsertTransferInput,
} from "@shared/types";
import {
  Bed,
  Bus,
  ExternalLink,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Trash2,
  User,
  Users,
  X,
} from "lucide-react";
import { type DragEvent, type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { Button, Dialog, Skeleton, useConfirm, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { accommodationApi, guestApi, transferApi } from "../lib/endpoints";
import { formatHuf } from "../lib/format";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

type LogisticsTab = "accommodation" | "transfer";

interface DragData {
  guestId: number;
}

export default function LogisticsPage() {
  const { t } = useT();
  useDocumentMeta("seo.logistics_title", "seo.logistics_description");
  const toast = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState<LogisticsTab>("accommodation");
  const [accommodations, setAccommodations] = useState<Accommodation[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingAccommodation, setEditingAccommodation] = useState<Accommodation | "new" | null>(
    null,
  );
  const [editingTransfer, setEditingTransfer] = useState<Transfer | "new" | null>(null);
  const [hoverAccommodationId, setHoverAccommodationId] = useState<number | null>(null);
  const [hoverTransferId, setHoverTransferId] = useState<number | null>(null);
  const [sidebarHover, setSidebarHover] = useState(false);

  const refresh = useCallback(async () => {
    const [acc, tr, gs] = await Promise.all([
      accommodationApi.list(),
      transferApi.list(),
      guestApi.list(),
    ]);
    setAccommodations(acc.accommodations);
    setTransfers(tr.transfers);
    setGuests(gs.guests);
  }, []);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const guestById = useMemo(() => new Map(guests.map((g) => [g.id, g])), [guests]);
  const guestsByAccommodation = useMemo(() => {
    const out = new Map<number, Guest[]>();
    for (const g of guests) {
      if (g.accommodation_id == null) continue;
      const arr = out.get(g.accommodation_id) ?? [];
      arr.push(g);
      out.set(g.accommodation_id, arr);
    }
    return out;
  }, [guests]);
  const guestsByTransfer = useMemo(() => {
    const out = new Map<number, Guest[]>();
    for (const g of guests) {
      if (g.transfer_id == null) continue;
      const arr = out.get(g.transfer_id) ?? [];
      arr.push(g);
      out.set(g.transfer_id, arr);
    }
    return out;
  }, [guests]);

  // Unassigned for the active tab — these are the rows shown in the sidebar.
  // Partner roles still appear so the couple can drop themselves into a unit;
  // they just don't get the seating page's special pinned slot here.
  const unassigned = useMemo(
    () =>
      guests.filter((g) =>
        tab === "accommodation" ? g.accommodation_id == null : g.transfer_id == null,
      ),
    [guests, tab],
  );

  // ── Mutations ────────────────────────────────────────────────────────────
  const assignAccommodation = useCallback(
    async (guestId: number, accommodationId: number | null) => {
      // Optimistic update — server is authoritative on refresh.
      setGuests((prev) =>
        prev.map((g) => (g.id === guestId ? { ...g, accommodation_id: accommodationId } : g)),
      );
      try {
        await accommodationApi.assign({ guest_id: guestId, accommodation_id: accommodationId });
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : t("logistics.save_failed"));
        await refresh();
      }
    },
    [refresh, toast, t],
  );

  const assignTransfer = useCallback(
    async (guestId: number, transferId: number | null) => {
      setGuests((prev) =>
        prev.map((g) => (g.id === guestId ? { ...g, transfer_id: transferId } : g)),
      );
      try {
        await transferApi.assign({ guest_id: guestId, transfer_id: transferId });
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : t("logistics.save_failed"));
        await refresh();
      }
    },
    [refresh, toast, t],
  );

  const deleteAccommodation = useCallback(
    async (a: Accommodation) => {
      const ok = await confirm({
        title: t("logistics.delete_accommodation_title"),
        body: t("logistics.delete_accommodation_body").replace("{name}", a.name),
        confirmLabel: t("common.delete"),
        cancelLabel: t("common.cancel"),
        destructive: true,
      });
      if (!ok) return;
      try {
        await accommodationApi.remove(a.id);
        await refresh();
        toast.success(t("logistics.accommodation_deleted"));
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : t("logistics.save_failed"));
      }
    },
    [confirm, refresh, toast, t],
  );

  const deleteTransfer = useCallback(
    async (tr: Transfer) => {
      const ok = await confirm({
        title: t("logistics.delete_transfer_title"),
        body: t("logistics.delete_transfer_body").replace("{label}", tr.label),
        confirmLabel: t("common.delete"),
        cancelLabel: t("common.cancel"),
        destructive: true,
      });
      if (!ok) return;
      try {
        await transferApi.remove(tr.id);
        await refresh();
        toast.success(t("logistics.transfer_deleted"));
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : t("logistics.save_failed"));
      }
    },
    [confirm, refresh, toast, t],
  );

  // ── DnD helpers ──────────────────────────────────────────────────────────
  const onDragStart = (e: DragEvent<HTMLElement>, guestId: number) => {
    const data: DragData = { guestId };
    e.dataTransfer.setData("application/json", JSON.stringify(data));
    e.dataTransfer.effectAllowed = "move";
  };
  const readDrag = (e: DragEvent<HTMLElement>): DragData | null => {
    try {
      const raw = e.dataTransfer.getData("application/json");
      return raw ? (JSON.parse(raw) as DragData) : null;
    } catch {
      return null;
    }
  };

  const dropOnAccommodation = (e: DragEvent<HTMLElement>, accommodationId: number) => {
    e.preventDefault();
    setHoverAccommodationId(null);
    const data = readDrag(e);
    if (!data) return;
    void assignAccommodation(data.guestId, accommodationId);
  };
  const dropOnTransfer = (e: DragEvent<HTMLElement>, transferId: number) => {
    e.preventDefault();
    setHoverTransferId(null);
    const data = readDrag(e);
    if (!data) return;
    void assignTransfer(data.guestId, transferId);
  };
  const dropOnSidebar = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    setSidebarHover(false);
    const data = readDrag(e);
    if (!data) return;
    if (tab === "accommodation") void assignAccommodation(data.guestId, null);
    else void assignTransfer(data.guestId, null);
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <AppShell>
      <header className="mb-6">
        <h1>{t("logistics.title")}</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-umber-300">{t("logistics.sub")}</p>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label={t("logistics.tabs_aria")}
          className="inline-flex rounded-lg border border-paper-300 bg-paper-100 p-0.5 dark:border-umber-700 dark:bg-umber-900"
        >
          <TabButton
            active={tab === "accommodation"}
            onClick={() => setTab("accommodation")}
            label={t("logistics.tab_accommodation")}
            icon={<Bed size={14} />}
          />
          <TabButton
            active={tab === "transfer"}
            onClick={() => setTab("transfer")}
            label={t("logistics.tab_transfer")}
            icon={<Bus size={14} />}
          />
        </div>
        <button
          type="button"
          className="btn-primary ml-auto"
          onClick={() =>
            tab === "accommodation" ? setEditingAccommodation("new") : setEditingTransfer("new")
          }
        >
          <Plus size={16} />{" "}
          {tab === "accommodation" ? t("logistics.add_accommodation") : t("logistics.add_transfer")}
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <section>
          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton variant="block" height={140} rounded="lg" />
              <Skeleton variant="block" height={140} rounded="lg" />
            </div>
          ) : tab === "accommodation" ? (
            accommodations.length === 0 ? (
              <EmptyState
                icon={<Bed size={24} className="text-ink-500 dark:text-umber-300" />}
                title={t("logistics.no_accommodations")}
                hint={t("logistics.no_accommodations_hint")}
              />
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {accommodations.map((a) => (
                  <li key={a.id}>
                    <AccommodationCard
                      accommodation={a}
                      assigned={guestsByAccommodation.get(a.id) ?? []}
                      isDropTarget={hoverAccommodationId === a.id}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (hoverAccommodationId !== a.id) setHoverAccommodationId(a.id);
                      }}
                      onDragLeave={(e) => {
                        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                        setHoverAccommodationId((cur) => (cur === a.id ? null : cur));
                      }}
                      onDrop={(e) => dropOnAccommodation(e, a.id)}
                      onEdit={() => setEditingAccommodation(a)}
                      onDelete={() => deleteAccommodation(a)}
                      onUnassign={(g) => assignAccommodation(g.id, null)}
                      onDragStartGuest={onDragStart}
                      t={t}
                    />
                  </li>
                ))}
              </ul>
            )
          ) : transfers.length === 0 ? (
            <EmptyState
              icon={<Bus size={24} className="text-ink-500 dark:text-umber-300" />}
              title={t("logistics.no_transfers")}
              hint={t("logistics.no_transfers_hint")}
            />
          ) : (
            <TransferTable
              transfers={transfers}
              guestsByTransfer={guestsByTransfer}
              hoverTransferId={hoverTransferId}
              setHoverTransferId={setHoverTransferId}
              onDrop={dropOnTransfer}
              onEdit={(tr) => setEditingTransfer(tr)}
              onDelete={deleteTransfer}
              onUnassign={(g) => assignTransfer(g.id, null)}
              onDragStartGuest={onDragStart}
              t={t}
            />
          )}
        </section>

        <aside
          className={`card sticky top-20 self-start transition-colors ${
            sidebarHover ? "ring-2 ring-blush-500 bg-blush-50 dark:bg-blush-400/15" : ""
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            if (!sidebarHover) setSidebarHover(true);
          }}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
            setSidebarHover(false);
          }}
          onDrop={dropOnSidebar}
        >
          <h2 className="text-lg">{t("logistics.sidebar_title")}</h2>
          <p className="mt-1 text-xs text-ink-500 dark:text-umber-300">
            {t(
              tab === "accommodation"
                ? "logistics.sidebar_help_accommodation"
                : "logistics.sidebar_help_transfer",
            )}
          </p>
          {unassigned.length === 0 ? (
            <p className="mt-4 text-sm text-ink-600 dark:text-umber-200">
              {t("logistics.sidebar_empty")}
            </p>
          ) : (
            <ul className="mt-3 max-h-[60vh] space-y-1 overflow-y-auto">
              {unassigned.map((g) => (
                <li key={g.id}>
                  <DraggableGuestRow guest={g} onDragStart={onDragStart} />
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      {editingAccommodation !== null && (
        <AccommodationDialog
          initial={editingAccommodation === "new" ? null : editingAccommodation}
          onClose={() => setEditingAccommodation(null)}
          onSaved={async () => {
            setEditingAccommodation(null);
            await refresh();
          }}
        />
      )}

      {editingTransfer !== null && (
        <TransferDialog
          initial={editingTransfer === "new" ? null : editingTransfer}
          onClose={() => setEditingTransfer(null)}
          onSaved={async () => {
            setEditingTransfer(null);
            await refresh();
          }}
        />
      )}
    </AppShell>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
        active
          ? "bg-white text-ink-900 shadow-sm dark:bg-umber-700 dark:text-paper-100"
          : "text-ink-600 hover:text-ink-900 dark:text-umber-200 dark:hover:text-paper-100"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <div className="card stationery text-center">
      <div className="mx-auto">{icon}</div>
      <h3 className="mt-3 text-base font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-ink-600 dark:text-umber-200">{hint}</p>
    </div>
  );
}

function DraggableGuestRow({
  guest,
  onDragStart,
  compact = false,
}: {
  guest: Guest;
  onDragStart: (e: DragEvent<HTMLElement>, guestId: number) => void;
  compact?: boolean;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, guest.id)}
      className={`flex cursor-grab items-center gap-2 rounded-md border border-paper-300 bg-paper-100 px-2 py-1.5 text-sm transition-colors active:cursor-grabbing hover:border-blush-300 dark:border-umber-700 dark:bg-umber-800 dark:hover:border-blush-400/60 ${
        compact ? "py-1" : ""
      }`}
    >
      <User size={14} className="shrink-0 text-ink-500 dark:text-umber-300" aria-hidden />
      <span className="truncate">{guest.full_name}</span>
    </div>
  );
}

function AssignedGuestChip({
  guest,
  onUnassign,
  onDragStart,
}: {
  guest: Guest;
  onUnassign: (g: Guest) => void;
  onDragStart: (e: DragEvent<HTMLElement>, guestId: number) => void;
}) {
  return (
    <span
      draggable
      onDragStart={(e) => onDragStart(e, guest.id)}
      className="inline-flex cursor-grab items-center gap-1 rounded-full bg-paper-200 px-2 py-0.5 text-xs active:cursor-grabbing dark:bg-umber-700"
    >
      <span className="truncate max-w-[120px]">{guest.full_name}</span>
      <button
        type="button"
        onClick={() => onUnassign(guest)}
        className="rounded-full p-0.5 hover:bg-paper-300 dark:hover:bg-umber-600"
        aria-label="Eltávolítás"
      >
        <X size={11} />
      </button>
    </span>
  );
}

function AccommodationCard({
  accommodation,
  assigned,
  isDropTarget,
  onDragOver,
  onDragLeave,
  onDrop,
  onEdit,
  onDelete,
  onUnassign,
  onDragStartGuest,
  t,
}: {
  accommodation: Accommodation;
  assigned: Guest[];
  isDropTarget: boolean;
  onDragOver: (e: DragEvent<HTMLElement>) => void;
  onDragLeave: (e: DragEvent<HTMLElement>) => void;
  onDrop: (e: DragEvent<HTMLElement>) => void;
  onEdit: () => void;
  onDelete: () => void;
  onUnassign: (g: Guest) => void;
  onDragStartGuest: (e: DragEvent<HTMLElement>, guestId: number) => void;
  t: (k: string) => string;
}) {
  const overCap = assigned.length > accommodation.capacity;
  return (
    <article
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`card flex h-full flex-col gap-3 transition-colors ${
        isDropTarget ? "ring-2 ring-blush-500 bg-blush-50 dark:bg-blush-400/15" : ""
      }`}
    >
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold">{accommodation.name}</h3>
          {accommodation.address && (
            <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-ink-500 dark:text-umber-300">
              <MapPin size={11} aria-hidden />
              <span className="truncate">{accommodation.address}</span>
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-md p-1.5 text-ink-500 hover:bg-paper-200 hover:text-ink-900 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-100"
            aria-label={t("common.edit")}
            title={t("common.edit")}
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-md p-1.5 text-ink-500 hover:bg-paper-200 hover:text-rose-600 dark:text-umber-300 dark:hover:bg-umber-700"
            aria-label={t("common.delete")}
            title={t("common.delete")}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </header>

      <dl className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-600 dark:text-umber-200">
        <div className="inline-flex items-center gap-1">
          <Users size={11} aria-hidden />
          <span className={overCap ? "text-rose-600 dark:text-rose-400" : undefined}>
            {assigned.length}/{accommodation.capacity}
          </span>
        </div>
        {accommodation.price_huf !== null && (
          <div>
            <span className="font-medium">{formatHuf(accommodation.price_huf)}</span>
          </div>
        )}
        {accommodation.contact && (
          <div className="inline-flex items-center gap-1">
            <Phone size={11} aria-hidden />
            <span className="truncate">{accommodation.contact}</span>
          </div>
        )}
        {accommodation.link && (
          <a
            href={accommodation.link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-blush-700 hover:underline dark:text-blush-300"
          >
            <ExternalLink size={11} aria-hidden />
            {t("logistics.link")}
          </a>
        )}
      </dl>

      <div className="min-h-[44px] flex-1 rounded-md border border-dashed border-paper-300 p-2 dark:border-umber-700">
        {assigned.length === 0 ? (
          <p className="text-center text-xs text-ink-400 dark:text-umber-400">
            {t("logistics.drop_guest_here")}
          </p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {assigned.map((g) => (
              <AssignedGuestChip
                key={g.id}
                guest={g}
                onUnassign={onUnassign}
                onDragStart={onDragStartGuest}
              />
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function TransferTable({
  transfers,
  guestsByTransfer,
  hoverTransferId,
  setHoverTransferId,
  onDrop,
  onEdit,
  onDelete,
  onUnassign,
  onDragStartGuest,
  t,
}: {
  transfers: Transfer[];
  guestsByTransfer: Map<number, Guest[]>;
  hoverTransferId: number | null;
  setHoverTransferId: (id: number | null) => void;
  onDrop: (e: DragEvent<HTMLElement>, transferId: number) => void;
  onEdit: (tr: Transfer) => void;
  onDelete: (tr: Transfer) => void;
  onUnassign: (g: Guest) => void;
  onDragStartGuest: (e: DragEvent<HTMLElement>, guestId: number) => void;
  t: (k: string) => string;
}) {
  return (
    <div className="card overflow-x-auto p-0">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-paper-300 bg-paper-100 text-left text-xs uppercase tracking-wide text-ink-500 dark:border-umber-700 dark:bg-umber-900 dark:text-umber-300">
            <th className="px-3 py-2">{t("logistics.transfer_label")}</th>
            <th className="px-3 py-2">{t("logistics.transfer_direction")}</th>
            <th className="px-3 py-2">{t("logistics.transfer_depart_at")}</th>
            <th className="px-3 py-2">{t("logistics.transfer_capacity")}</th>
            <th className="px-3 py-2">{t("logistics.transfer_assigned")}</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {transfers.map((tr) => {
            const assigned = guestsByTransfer.get(tr.id) ?? [];
            const overCap = tr.capacity !== null && assigned.length > tr.capacity;
            return (
              <tr
                key={tr.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (hoverTransferId !== tr.id) setHoverTransferId(tr.id);
                }}
                onDragLeave={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                  if (hoverTransferId === tr.id) setHoverTransferId(null);
                }}
                onDrop={(e) => onDrop(e, tr.id)}
                className={`border-b border-paper-200 last:border-b-0 dark:border-umber-700 ${
                  hoverTransferId === tr.id ? "bg-blush-50 dark:bg-blush-400/15" : ""
                }`}
              >
                <td className="px-3 py-2 align-top font-medium">{tr.label}</td>
                <td className="px-3 py-2 align-top text-ink-600 dark:text-umber-200">
                  {tr.direction ?? "—"}
                </td>
                <td className="px-3 py-2 align-top text-ink-600 dark:text-umber-200">
                  {tr.depart_at ? formatDepartAt(tr.depart_at) : "—"}
                </td>
                <td className="px-3 py-2 align-top text-ink-600 dark:text-umber-200">
                  <span className={overCap ? "text-rose-600 dark:text-rose-400" : undefined}>
                    {assigned.length}
                    {tr.capacity !== null ? `/${tr.capacity}` : ""}
                  </span>
                </td>
                <td className="px-3 py-2 align-top">
                  {assigned.length === 0 ? (
                    <span className="text-xs text-ink-400 dark:text-umber-400">
                      {t("logistics.drop_guest_here")}
                    </span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {assigned.map((g) => (
                        <AssignedGuestChip
                          key={g.id}
                          guest={g}
                          onUnassign={onUnassign}
                          onDragStart={onDragStartGuest}
                        />
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 align-top">
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => onEdit(tr)}
                      className="rounded-md p-1.5 text-ink-500 hover:bg-paper-200 hover:text-ink-900 dark:text-umber-300 dark:hover:bg-umber-700"
                      aria-label={t("common.edit")}
                      title={t("common.edit")}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(tr)}
                      className="rounded-md p-1.5 text-ink-500 hover:bg-paper-200 hover:text-rose-600 dark:text-umber-300 dark:hover:bg-umber-700"
                      aria-label={t("common.delete")}
                      title={t("common.delete")}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatDepartAt(value: string): string {
  // "YYYY-MM-DDTHH:MM" → "YYYY-MM-DD HH:MM" for display.
  return value.replace("T", " ");
}

// ── Dialogs ───────────────────────────────────────────────────────────────

function AccommodationDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: Accommodation | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { t } = useT();
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [capacity, setCapacity] = useState<string>(String(initial?.capacity ?? 2));
  const [priceHuf, setPriceHuf] = useState<string>(
    initial?.price_huf != null ? String(initial.price_huf) : "",
  );
  const [link, setLink] = useState(initial?.link ?? "");
  const [contact, setContact] = useState(initial?.contact ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t("logistics.name_required"));
      return;
    }
    const cap = Number(capacity);
    if (!Number.isInteger(cap) || cap < 1) {
      toast.error(t("logistics.capacity_invalid"));
      return;
    }
    const price = priceHuf.trim() === "" ? null : Number(priceHuf);
    if (price !== null && (!Number.isFinite(price) || price < 0)) {
      toast.error(t("logistics.price_invalid"));
      return;
    }
    const body: UpsertAccommodationInput = {
      name: trimmed,
      address: address.trim() || null,
      capacity: cap,
      price_huf: price,
      link: link.trim() || null,
      contact: contact.trim() || null,
      notes: notes.trim() || null,
    };
    setSubmitting(true);
    try {
      if (initial) await accommodationApi.update(initial.id, body);
      else await accommodationApi.create(body);
      await onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("logistics.save_failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      title={initial ? t("logistics.edit_accommodation") : t("logistics.add_accommodation")}
      onClose={onClose}
      closeOnBackdrop
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={onSubmit} disabled={submitting}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label={t("logistics.name")}>
          <input
            type="text"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </Field>
        <Field label={t("logistics.address")}>
          <input
            type="text"
            className="input"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("logistics.capacity")}>
            <input
              type="number"
              min={1}
              max={100}
              className="input"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
          </Field>
          <Field label={t("logistics.price_huf")}>
            <input
              type="number"
              min={0}
              step={1000}
              className="input"
              value={priceHuf}
              onChange={(e) => setPriceHuf(e.target.value)}
              placeholder="—"
            />
          </Field>
        </div>
        <Field label={t("logistics.link")}>
          <input
            type="url"
            className="input"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://"
          />
        </Field>
        <Field label={t("logistics.contact")}>
          <input
            type="text"
            className="input"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder={t("logistics.contact_placeholder")}
          />
        </Field>
        <Field label={t("logistics.notes")}>
          <textarea
            className="input"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
      </form>
    </Dialog>
  );
}

function TransferDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: Transfer | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { t } = useT();
  const toast = useToast();
  const [label, setLabel] = useState(initial?.label ?? "");
  const [direction, setDirection] = useState(initial?.direction ?? "");
  const [departAt, setDepartAt] = useState(initial?.depart_at ?? "");
  const [capacity, setCapacity] = useState<string>(
    initial?.capacity != null ? String(initial.capacity) : "",
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = label.trim();
    if (!trimmed) {
      toast.error(t("logistics.label_required"));
      return;
    }
    const cap = capacity.trim() === "" ? null : Number(capacity);
    if (cap !== null && (!Number.isInteger(cap) || cap < 1)) {
      toast.error(t("logistics.capacity_invalid"));
      return;
    }
    const body: UpsertTransferInput = {
      label: trimmed,
      direction: direction.trim() || null,
      depart_at: departAt.trim() || null,
      capacity: cap,
      notes: notes.trim() || null,
    };
    setSubmitting(true);
    try {
      if (initial) await transferApi.update(initial.id, body);
      else await transferApi.create(body);
      await onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("logistics.save_failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      title={initial ? t("logistics.edit_transfer") : t("logistics.add_transfer")}
      onClose={onClose}
      closeOnBackdrop
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={onSubmit} disabled={submitting}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label={t("logistics.transfer_label")}>
          <input
            type="text"
            className="input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("logistics.transfer_label_placeholder")}
            autoFocus
          />
        </Field>
        <Field label={t("logistics.transfer_direction")}>
          <input
            type="text"
            className="input"
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            placeholder={t("logistics.transfer_direction_placeholder")}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("logistics.transfer_depart_at")}>
            <input
              type="datetime-local"
              className="input"
              value={departAt}
              onChange={(e) => setDepartAt(e.target.value)}
            />
          </Field>
          <Field label={t("logistics.transfer_capacity")}>
            <input
              type="number"
              min={1}
              max={200}
              className="input"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="—"
            />
          </Field>
        </div>
        <Field label={t("logistics.notes")}>
          <textarea
            className="input"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
      </form>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-600 dark:text-umber-200">
        {label}
      </span>
      {children}
    </label>
  );
}
