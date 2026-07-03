import { ArrowRight, Clock, MailQuestion, Plus, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { PlannerClientView } from "@shared/types";
import { plannerApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";
import { titleCaseName } from "../../lib/planner_display";

// Client avatars share ONE neutral background; only the initials differ.
// Per-client hues made the roster read as random confetti, so identity
// colour is reserved for surfaces that need disambiguation (calendar).
const AVATAR_CLASS = "bg-paper-200 text-umber-700 dark:bg-umber-700 dark:text-paper-200";

function initials(displayName: string): string {
  // Join glyphs ("Shrek & Fiona") are not names — drop them so the avatar
  // reads "SF", never "S&".
  const parts = displayName
    .trim()
    .split(/\s+/)
    .filter((p) => p !== "&" && p !== "+");
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

// Consent status of the planner↔couple link. "active" is the default state
// and stays quiet; only a pending invite/request (awaiting the couple's
// approval) earns a badge; one indicator, one status.
function ConsentBadge({ status }: { status: string }) {
  const { t } = useT();
  if (status === "active") return null;
  return (
    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
      {t("planner_home.pipeline_pending")}
    </span>
  );
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
        onClick={(e) => e.stopPropagation()}
        placeholder={t("planner_home.notes_placeholder")}
      />
    );
  }

  if (value) {
    return (
      <button
        type="button"
        className="text-left text-xs text-umber-600 dark:text-umber-300 line-clamp-1 hover:underline"
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
      >
        {value}
      </button>
    );
  }

  return (
    <button
      type="button"
      className="btn-ghost text-xs px-0 py-0 text-umber-400 hover:text-umber-700 dark:text-umber-500 dark:hover:text-umber-300"
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
    >
      {t("planner_home.pipeline_notes_add")}
    </button>
  );
}

// ─── ClientCard ───────────────────────────────────────────────────────────────

function ClientCard({ client }: { client: PlannerClientView }) {
  const { t } = useT();
  const navigate = useNavigate();
  const [notes, setNotes] = useState(client.notes);
  const isActive = client.status === "active";

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
    // The whole card is a mouse-convenience click target for active clients;
    // the "Enter" Link below stays the keyboard/screen-reader affordance.
    <div
      className={`card p-4 transition ${
        isActive
          ? "cursor-pointer hover:-translate-y-0.5 hover:border-moss-400 hover:shadow-pop dark:hover:border-moss-500"
          : "cursor-default"
      }`}
      onClick={isActive ? () => navigate(`/app/planner/clients/${client.couple_id}`) : undefined}
    >
      {/* Top row */}
      <div className="flex items-center gap-3">
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0 ${AVATAR_CLASS}`}
        >
          {avatarInitials}
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-grotesk font-semibold text-base text-umber-900 dark:text-paper-50">
            <span className="block truncate">{titleCaseName(client.display_name)}</span>
          </p>
          {client.wedding_date && (
            <div className="mt-0.5 flex items-center gap-1">
              <Clock size={11} className="shrink-0 text-umber-400" aria-hidden="true" />
              <p className="truncate text-xs text-umber-500 dark:text-umber-400">
                <span className="text-umber-400 dark:text-umber-500">
                  {t("planner_clients.wedding_label")}{" "}
                </span>
                <span className="whitespace-nowrap">{formatWeddingDate(client.wedding_date)}</span>
              </p>
            </div>
          )}
        </div>

        <ConsentBadge status={client.status} />
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

        {/* Pending cards get no button; the header badge already explains
            why there's nothing to enter (the couple hasn't approved yet). */}
        {client.status === "active" && (
          <Link
            to={`/app/planner/clients/${client.couple_id}`}
            className="btn-moss btn-sm flex flex-shrink-0 items-center gap-1.5"
            onClick={(e) => e.stopPropagation()}
            title={t("planner_home.pipeline_enter")}
          >
            {t("planner_home.pipeline_enter")}
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
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
        <h2 className="flex items-center gap-2 font-grotesk text-lg font-semibold text-umber-900 dark:text-paper-50">
          <Users
            size={16}
            className="shrink-0 text-moss-600 dark:text-moss-400"
            aria-hidden="true"
          />
          {t("planner_home.pipeline_title")} ({clients.length})
        </h2>

        <div className="flex items-center gap-2">
          {inviteCount > 0 && (
            <span className="flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
              <MailQuestion size={12} aria-hidden="true" />
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
        <div
          className={`grid gap-4 ${
            clients.length <= 2 ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2"
          }`}
        >
          {clients.map((client) => (
            <ClientCard key={client.couple_id} client={client} />
          ))}
        </div>
      )}
    </section>
  );
}
