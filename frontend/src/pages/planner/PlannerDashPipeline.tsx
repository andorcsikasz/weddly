import { AlertTriangle, CheckCircle2, Clock, Plus, UserPlus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { PlannerClientView } from "@shared/types";
import { plannerApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";

// Client avatar colors — warm, muted palette aligned with the design system.
// Uses eucalyptus + blush + umber-adjacent tones instead of raw Tailwind colors.
const CLIENT_COLORS = [
  "bg-blush-100 text-blush-800",
  "bg-eucalyptus-100 text-eucalyptus-800",
  "bg-amber-100 text-amber-800",
  "bg-violet-100 text-violet-800",
  "bg-eucalyptus-200 text-eucalyptus-900",
  "bg-blush-200 text-blush-900",
  "bg-amber-200 text-amber-900",
  "bg-paper-300 text-umber-800",
] as const;

function initials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  if (parts.length >= 2) {
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return displayName.slice(0, 2).toUpperCase();
}

function daysUntil(weddingDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(weddingDate);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function formatWeddingDate(ymd: string): string {
  const [year, month, day] = ymd.split("-");
  if (!year || !month || !day) return ymd;
  return `${year}. ${month}. ${day}.`;
}

// Consent status of the planner↔couple link. "active" means the couple has
// approved access; anything else (pending invite / requested) is awaiting the
// couple's approval, so we surface it explicitly on the card.
function ConsentBadge({ status }: { status: string }) {
  const { t } = useT();
  const isActive = status === "active";
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        isActive
          ? "bg-moss-100 text-moss-900 dark:bg-moss-900/40 dark:text-moss-100"
          : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
      }`}
    >
      {isActive ? t("couple_planners.status_active") : t("planner_home.pipeline_pending")}
    </span>
  );
}

function HealthIcon({ overdue }: { overdue: number }) {
  if (overdue === 0)
    return <CheckCircle2 size={14} className="shrink-0 text-moss-600" aria-hidden="true" />;
  if (overdue < 3)
    return <AlertTriangle size={14} className="shrink-0 text-amber-500" aria-hidden="true" />;
  return <AlertTriangle size={14} className="shrink-0 text-red-500" aria-hidden="true" />;
}

// ─── InlineNotes ──────────────────────────────────────────────────────────────

function InlineNotes({
  coupleId,
  initial,
  onSave,
}: {
  coupleId: number;
  initial: string | null;
  onSave: (v: string) => void;
}) {
  const { t } = useT();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initial ?? "");

  function handleBlur() {
    void plannerApi.updateNotes(coupleId, value).then(() => {
      onSave(value);
      setEditing(false);
    });
  }

  if (editing) {
    return (
      <textarea
        rows={3}
        className="input w-full text-xs mt-1"
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
        placeholder={t("planner_home.notes_placeholder")}
      />
    );
  }

  if (value) {
    return (
      <button
        type="button"
        className="text-left text-xs text-umber-600 dark:text-umber-300 line-clamp-1 hover:underline"
        onClick={() => setEditing(true)}
      >
        {value}
      </button>
    );
  }

  return (
    <button
      type="button"
      className="btn-ghost text-xs px-0 py-0 text-umber-400 hover:text-umber-700 dark:text-umber-500 dark:hover:text-umber-300"
      onClick={() => setEditing(true)}
    >
      {t("planner_home.pipeline_notes_add")}
    </button>
  );
}

// ─── ClientCard ───────────────────────────────────────────────────────────────

function ClientCard({ client }: { client: PlannerClientView }) {
  const { t } = useT();
  const [notes, setNotes] = useState(client.notes);

  const colorClass = CLIENT_COLORS[client.couple_id % 8] ?? CLIENT_COLORS[0];
  const avatarInitials = initials(client.display_name);
  const { total, done, overdue } = client.task_summary;
  const barWidth = `${Math.round((done / Math.max(total, 1)) * 100)}%`;

  const days = client.wedding_date ? daysUntil(client.wedding_date) : null;

  let daysLabel = "";
  let daysUrgent = false;
  if (days !== null) {
    if (days === 0) {
      daysLabel = t("planner_home.pipeline_today");
    } else if (days > 0) {
      daysLabel = t("planner_home.pipeline_days_until").replace("{{n}}", String(days));
      daysUrgent = days <= 7;
    } else {
      daysLabel = t("planner_home.pipeline_days_ago").replace("{{n}}", String(Math.abs(days)));
    }
  }

  return (
    <div className="card p-4 hover:shadow-md transition-shadow cursor-default">
      {/* Top row */}
      <div className="flex items-center gap-3">
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0 ${colorClass}`}
        >
          {avatarInitials}
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-grotesk font-semibold text-base text-umber-900 dark:text-paper-50 truncate">
            {client.display_name}
          </p>
          {client.wedding_date && (
            <div className="mt-0.5 flex items-center gap-1">
              <Clock size={11} className="shrink-0 text-umber-400" aria-hidden="true" />
              <p className="text-xs text-umber-500 dark:text-umber-400">
                {formatWeddingDate(client.wedding_date)}
              </p>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <ConsentBadge status={client.status} />
          <HealthIcon overdue={overdue} />
        </div>
      </div>

      {/* Row 2: days until + guest count */}
      {(days !== null || client.confirmed_guests > 0) && (
        <div className="mt-2 flex items-baseline gap-3">
          {days !== null && (
            <span
              className={`text-sm font-medium ${
                daysUrgent && days > 0
                  ? "text-red-500 dark:text-red-400"
                  : "text-umber-700 dark:text-umber-300"
              }`}
            >
              {daysLabel}
            </span>
          )}
          <span className="text-xs text-umber-500 dark:text-umber-400">
            {t("planner_home.pipeline_guests").replace("{{n}}", String(client.confirmed_guests))}
          </span>
        </div>
      )}

      {/* Row 3: task health bar */}
      {total > 0 && (
        <div className="mt-3">
          <div className="h-1.5 rounded-full bg-paper-200 dark:bg-umber-700 overflow-hidden">
            <div
              className="h-full rounded-full bg-moss-500 transition-all"
              style={{ width: barWidth }}
            />
          </div>
          <p className="mt-0.5 text-xs text-umber-500 dark:text-umber-400">
            {t("planner_home.pipeline_tasks_done")
              .replace("{{done}}", String(done))
              .replace("{{total}}", String(total))}
            {overdue > 0 && (
              <>
                {" · "}
                <span className="text-red-500">
                  {t("planner_home.pipeline_tasks_overdue").replace("{{n}}", String(overdue))}
                </span>
              </>
            )}
          </p>
        </div>
      )}

      {/* Row 4: notes + enter button */}
      <div className="mt-3 flex items-end justify-between gap-2">
        <div className="flex-1 min-w-0">
          <InlineNotes
            coupleId={client.couple_id}
            initial={notes}
            onSave={(v) => setNotes(v || null)}
          />
        </div>

        {client.status === "active" ? (
          <Link
            to={`/app/planner/clients/${client.couple_id}`}
            className="btn-primary btn-sm flex-shrink-0"
          >
            {t("planner_home.pipeline_enter")}
          </Link>
        ) : (
          // Pending request — the couple hasn't approved access yet, so there's
          // nothing to enter. Entering would 403 server-side.
          <span className="btn-sm flex-shrink-0 cursor-default rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
            {t("planner_home.pipeline_pending")}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── PlannerDashPipeline ──────────────────────────────────────────────────────

interface Props {
  clients: PlannerClientView[];
  onAddClientClick: () => void;
  inviteCount: number;
}

export function PlannerDashPipeline({ clients, onAddClientClick, inviteCount }: Props) {
  const { t } = useT();

  return (
    <section>
      {/* Section header */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="font-grotesk text-lg font-semibold text-umber-900 dark:text-paper-50">
          {t("planner_home.pipeline_title")} ({clients.length})
        </h2>

        <div className="flex items-center gap-2">
          {inviteCount > 0 && (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
              {t("planner_home.pipeline_pending_invites").replace("{{n}}", String(inviteCount))}
            </span>
          )}
          <button
            type="button"
            className="btn-outline btn-sm flex items-center gap-1"
            onClick={onAddClientClick}
          >
            <Plus size={14} />
            {t("planner_home.pipeline_add_btn")}
          </button>
        </div>
      </div>

      {/* Client grid or empty state */}
      {clients.length === 0 ? (
        <div className="card p-10 flex flex-col items-center text-center gap-3">
          <UserPlus size={48} strokeWidth={1.2} className="text-umber-300 dark:text-umber-600" />
          <p className="font-grotesk font-semibold text-base text-umber-900 dark:text-paper-50">
            {t("planner_home.pipeline_empty_title")}
          </p>
          <p className="text-sm text-umber-500 dark:text-umber-400 max-w-xs">
            {t("planner_home.pipeline_empty_body")}
          </p>
          <button
            type="button"
            className="btn-primary mt-1 flex items-center gap-1"
            onClick={onAddClientClick}
          >
            <Plus size={14} />
            {t("planner_home.pipeline_add_btn")}
          </button>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
          {clients.map((client) => (
            <ClientCard key={client.couple_id} client={client} />
          ))}
        </div>
      )}
    </section>
  );
}
