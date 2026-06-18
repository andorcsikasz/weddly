// Admin triage for planner waitlist submissions from /planners.

import type {
  PlannerWaitlistAdminView,
  PlannerWaitlistOutcome,
  PlannerWaitlistStatus,
} from "@shared/planner_waitlist";
import { Check, Clock, Loader2, RotateCcw, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { AdminEmptyState, AdminFilterChip, AdminPageHeader, Pill } from "../components/admin";
import type { PillTone } from "../components/admin";
import { Button, useConfirm, useToast } from "../components/ui";
import { adminPlannerWaitlistApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

const STATUS_PILL: Record<PlannerWaitlistStatus, { tone: PillTone; Icon: typeof Sparkles }> = {
  new: { tone: "blush", Icon: Sparkles },
  under_review: { tone: "violet", Icon: Clock },
  accepted: { tone: "sage", Icon: Check },
  rejected: { tone: "muted", Icon: X },
};

const STATUS_LABELS: Record<PlannerWaitlistStatus, string> = {
  new: "Beérkezett",
  under_review: "Átnézés alatt",
  accepted: "Elfogadva",
  rejected: "Elutasítva",
};

const FILTER_LABELS: Record<PlannerWaitlistStatus, string> = {
  new: "Beérkezett",
  under_review: "Átnézés alatt",
  accepted: "Elfogadva",
  rejected: "Elutasítva",
};

const EMPTY_LABELS: Record<PlannerWaitlistStatus, string> = {
  new: "Minden jelentkezésre válaszoltál — a várólista üres.",
  under_review: "Nincs átnézés alatt lévő jelentkezés.",
  accepted: "Még nem fogadtál el szervezőt.",
  rejected: "Még nem utasítottál el jelentkezést.",
};

const ALL_STATUSES: PlannerWaitlistStatus[] = ["new", "under_review", "accepted", "rejected"];

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("hu-HU", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ── Decide modal ─────────────────────────────────────────────────────────────

interface DecideModalProps {
  entry: PlannerWaitlistAdminView;
  onClose: () => void;
  onSaved: (updated: PlannerWaitlistAdminView) => void;
}

function DecideModal({ entry, onClose, onSaved }: DecideModalProps) {
  const [outcome, setOutcome] = useState<PlannerWaitlistOutcome>("under_review");
  const [notes, setNotes] = useState(entry.notes ?? "");
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function handleSave() {
    setSaving(true);
    try {
      const result = await adminPlannerWaitlistApi.decide(entry.id, { outcome, notes });
      if (result.entry) onSaved(result.entry);
      onClose();
    } catch {
      toast("Nem sikerült menteni. Próbáld újra.", "error");
    } finally {
      setSaving(false);
    }
  }

  const labelClass = "block text-sm font-medium text-umber-800 dark:text-umber-200 mb-1";
  const inputClass =
    "w-full rounded-md border border-paper-300 bg-paper-50 px-3 py-2 text-sm text-umber-900 focus:border-umber-500 focus:outline-none focus:ring-1 focus:ring-umber-500 dark:border-umber-700 dark:bg-umber-900 dark:text-paper-50 dark:focus:border-umber-400 dark:focus:ring-umber-400";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="w-full max-w-md rounded-t-2xl bg-paper-50 p-6 shadow-xl dark:bg-umber-900 sm:rounded-2xl">
        <h2 className="mb-4 text-base font-semibold text-umber-900 dark:text-paper-50">
          Döntés — {entry.full_name}
        </h2>

        <div className="mb-4">
          <p className={labelClass}>Kimenetel</p>
          <div className="flex gap-2">
            {(["under_review", "accepted", "rejected"] as PlannerWaitlistOutcome[]).map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => setOutcome(o)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  outcome === o
                    ? "bg-umber-700 text-paper-50 dark:bg-umber-300 dark:text-umber-900"
                    : "bg-paper-200 text-umber-700 hover:bg-paper-300 dark:bg-umber-800 dark:text-umber-300 dark:hover:bg-umber-700"
                }`}
              >
                {STATUS_LABELS[o]}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-5">
          <label htmlFor="planner-decide-notes" className={labelClass}>
            Belső megjegyzés (opcionális)
          </label>
          <textarea
            id="planner-decide-notes"
            rows={3}
            className={inputClass}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="pl. egyeztettünk, visszaírtunk…"
          />
        </div>

        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={saving}>
            Mégse
          </Button>
          <Button className="flex-[2]" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : "Mentés"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Entry card ────────────────────────────────────────────────────────────────

interface EntryCardProps {
  entry: PlannerWaitlistAdminView;
  onUpdate: (updated: PlannerWaitlistAdminView) => void;
}

function EntryCard({ entry, onUpdate }: EntryCardProps) {
  const [deciding, setDeciding] = useState(false);
  const [reopening, setReopening] = useState(false);
  const confirm = useConfirm();
  const toast = useToast();
  const { tone, Icon } = STATUS_PILL[entry.status];

  async function handleReopen() {
    const ok = await confirm({
      title: "Visszanyitás?",
      body: `A(z) "${STATUS_LABELS[entry.status]}" döntést töröljük és az entry visszakerül a beérkezettekhez.`,
      confirmLabel: "Visszanyitás",
    });
    if (!ok) return;
    setReopening(true);
    try {
      const result = await adminPlannerWaitlistApi.reopen(entry.id);
      if (result.entry) onUpdate(result.entry);
    } catch {
      toast("Nem sikerült visszanyitni.", "error");
    } finally {
      setReopening(false);
    }
  }

  return (
    <>
      {deciding && (
        <DecideModal
          entry={entry}
          onClose={() => setDeciding(false)}
          onSaved={(updated) => {
            onUpdate(updated);
            setDeciding(false);
          }}
        />
      )}
      <div className="admin-card">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Pill tone={tone} icon={<Icon size={11} />}>
                {STATUS_LABELS[entry.status]}
              </Pill>
              <span className="text-xs text-umber-500 dark:text-umber-400">
                {fmtDate(entry.created_at)}
              </span>
            </div>
            <p className="mt-2 font-medium text-umber-900 dark:text-paper-50">{entry.full_name}</p>
            <p className="text-sm text-umber-700 dark:text-umber-300">{entry.email}</p>
            <p className="text-sm text-umber-700 dark:text-umber-300">{entry.phone}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            {entry.status === "new" || entry.status === "under_review" ? (
              <Button size="sm" onClick={() => setDeciding(true)}>
                Döntés
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={handleReopen}
                disabled={reopening}
                aria-label="Visszanyitás"
              >
                {reopening ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <RotateCcw size={13} />
                )}
              </Button>
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-y-1 text-sm text-umber-700 dark:text-umber-300">
          {entry.company_name && (
            <p>
              <span className="font-medium text-umber-900 dark:text-paper-100">Cég:</span>{" "}
              {entry.company_name}
            </p>
          )}
          {entry.city && (
            <p>
              <span className="font-medium text-umber-900 dark:text-paper-100">Helyszín:</span>{" "}
              {entry.city}
            </p>
          )}
          {entry.years_experience !== null && (
            <p>
              <span className="font-medium text-umber-900 dark:text-paper-100">Tapasztalat:</span>{" "}
              {entry.years_experience} év
            </p>
          )}
          {entry.message && (
            <p className="mt-2 whitespace-pre-wrap rounded-md bg-paper-100 p-2 text-xs dark:bg-umber-800">
              {entry.message}
            </p>
          )}
          {entry.notes && (
            <p className="mt-1 text-xs italic text-umber-500 dark:text-umber-400">
              Megjegyzés: {entry.notes}
            </p>
          )}
        </div>
      </div>
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminPlannerWaitlistPage() {
  const t = useT();
  const [filter, setFilter] = useState<PlannerWaitlistStatus>("new");
  const [entries, setEntries] = useState<PlannerWaitlistAdminView[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void adminPlannerWaitlistApi.list().then((r) => {
      setEntries(r.entries);
      setLoading(false);
    });
  }, []);

  function handleUpdate(updated: PlannerWaitlistAdminView) {
    setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
  }

  const visible = entries.filter((e) => e.status === filter);

  return (
    <>
      <AdminPageHeader
        title={t("admin.nav_planner_waitlist")}
        subtitle={`${entries.filter((e) => e.status === "new").length} beérkezett`}
      />

      <div className="mb-6 flex flex-wrap gap-2">
        {ALL_STATUSES.map((s) => (
          <AdminFilterChip
            key={s}
            active={filter === s}
            count={entries.filter((e) => e.status === s).length}
            onClick={() => setFilter(s)}
          >
            {FILTER_LABELS[s]}
          </AdminFilterChip>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-umber-500">
          <Loader2 size={14} className="animate-spin" />
          Töltés…
        </div>
      ) : visible.length === 0 ? (
        <AdminEmptyState>{EMPTY_LABELS[filter]}</AdminEmptyState>
      ) : (
        <div className="space-y-4">
          {visible.map((entry) => (
            <EntryCard key={entry.id} entry={entry} onUpdate={handleUpdate} />
          ))}
        </div>
      )}
    </>
  );
}
