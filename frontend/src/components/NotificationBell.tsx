// Top-bar notification bell. Polls the merged feed (live timeline items +
// stored events) every 30s, shows an unread badge, and drops a panel listing
// what needs attention. Opening the panel stamps the read watermark (per-user,
// so it never clears the partner's badge) and optimistically zeroes the badge —
// the same optimistic-then-roundtrip shape AppShell already uses for admin
// section badges. Labels are composed here via t() from kind + data, so the
// stored payload never freezes locale.

import type { NotifEmailCadence, NotifFocus } from "@shared/notifications";
import {
  NOTIF_EMAIL_CADENCE_VALUES,
  NOTIF_FOCUS_ALL,
  parseNotifFocus,
  serializeNotifFocus,
} from "@shared/notifications";
import type { NotificationItem } from "@shared/notifications";
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  CalendarClock,
  ClipboardList,
  Clock,
  Info,
  ListChecks,
  Mail,
  MessageCircle,
  Send,
  Settings,
} from "lucide-react";
import { type ComponentType, type SVGProps, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { coupleApi, notificationApi } from "../lib/endpoints";
import { FeedbackDialog } from "./FeedbackDialog";
import { useT } from "../lib/i18n";

type IconCmp = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;

const KIND_ICON: Record<NotificationItem["kind"], IconCmp> = {
  timeline_overdue: AlertTriangle,
  timeline_due: CalendarClock,
  rsvp_received: Mail,
  rsvp_received_household: Mail,
  partner_task_added: ClipboardList,
  timeline_email_sent: Send,
  admin_message: Info,
  feedback_survey: MessageCircle,
  planning_stale_task: Clock,
  planning_decisions_stale: ListChecks,
};

/** Compose the human label for a feed row from its kind + params. */
function useLabel() {
  const { t } = useT();
  return (item: NotificationItem): string => {
    const d = item.data;
    switch (item.kind) {
      case "timeline_overdue":
        return t("notifications.timeline_overdue", { task: String(d.taskTitle ?? "") });
      case "timeline_due":
        return t("notifications.timeline_due", { task: String(d.taskTitle ?? "") });
      case "rsvp_received":
        return t("notifications.rsvp_received", {
          guest: String(d.guestName ?? ""),
          status: t(`notifications.rsvp_${String(d.rsvpStatus ?? "yes")}`),
        });
      case "rsvp_received_household":
        return t("notifications.rsvp_received_household", {
          count: Number(d.count ?? 0),
          household: String(d.householdLabel ?? ""),
        });
      case "partner_task_added":
        if (item.is_own_action) return t("notifications.partner_task_added_self");
        return d.actorName
          ? t("notifications.partner_task_added_named", { name: String(d.actorName) })
          : t("notifications.partner_task_added");
      case "timeline_email_sent":
        return t("notifications.timeline_email_sent");
      case "admin_message":
        return String(d.message ?? "");
      case "feedback_survey":
        return t("notifications.feedback_survey");
      case "planning_stale_task":
        return t("notifications.planning_stale_task", { task: String(d.taskTitle ?? "") });
      case "planning_decisions_stale":
        return t("notifications.planning_decisions_stale", { count: Number(d.count ?? 0) });
      default:
        return "";
    }
  };
}

const CADENCE_KEY_MAP: Record<NotifEmailCadence, string> = {
  never: "notifications.settings_cadence_never",
  "1_weekly": "notifications.settings_cadence_1_weekly",
  "2_weekly": "notifications.settings_cadence_2_weekly",
  "4_weekly": "notifications.settings_cadence_4_weekly",
};

const FOCUS_ITEMS: { key: NotifFocus; labelKey: string }[] = [
  { key: "timeline", labelKey: "notifications.settings_focus_timeline" },
  { key: "rsvp", labelKey: "notifications.settings_focus_rsvp" },
  { key: "partner", labelKey: "notifications.settings_focus_partner" },
];

function SettingsPanel({ onBack }: { onBack: () => void }) {
  const { t } = useT();
  const [cadence, setCadence] = useState<NotifEmailCadence>("1_weekly");
  const [focus, setFocus] = useState<NotifFocus[]>([...NOTIF_FOCUS_ALL]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load current couple prefs on mount.
  useEffect(() => {
    coupleApi
      .current()
      .then(({ couple }) => {
        if (!couple) return;
        setCadence(
          (NOTIF_EMAIL_CADENCE_VALUES as readonly string[]).includes(couple.notif_email_cadence)
            ? (couple.notif_email_cadence as NotifEmailCadence)
            : "1_weekly",
        );
        const parsed = parseNotifFocus(couple.notif_focus);
        setFocus(parsed.length ? parsed : [...NOTIF_FOCUS_ALL]);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  async function persist(nextCadence: NotifEmailCadence, nextFocus: NotifFocus[]) {
    setSaving(true);
    try {
      await coupleApi.update({
        notif_email_cadence: nextCadence,
        notif_focus: serializeNotifFocus(nextFocus),
      });
    } catch {
      /* non-critical */
    } finally {
      setSaving(false);
    }
  }

  function handleCadenceChange(next: NotifEmailCadence) {
    setCadence(next);
    void persist(next, focus);
  }

  function handleFocusToggle(key: NotifFocus) {
    const next = focus.includes(key) ? focus.filter((f) => f !== key) : [...focus, key];
    setFocus(next);
    void persist(cadence, next);
  }

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-paper-200 px-4 py-3 dark:border-umber-700">
        <button
          type="button"
          onClick={onBack}
          aria-label={t("notifications.settings_back")}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-paper-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:text-umber-300 dark:hover:bg-umber-700"
        >
          <ArrowLeft size={14} aria-hidden="true" />
        </button>
        <p className="font-grotesk text-sm font-semibold text-ink-900 dark:text-paper-50">
          {t("notifications.settings_title")}
        </p>
        {saving && <span className="ml-auto text-xs text-ink-400 dark:text-umber-400">…</span>}
      </div>

      {!loaded ? (
        <div className="px-4 py-8 text-center text-sm text-ink-400 dark:text-umber-400">…</div>
      ) : (
        <div className="divide-y divide-paper-200 dark:divide-umber-700">
          {/* Method */}
          <div className="px-4 py-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-400 dark:text-umber-400">
              {t("notifications.settings_method_label")}
            </p>
            <div className="flex flex-col gap-1.5">
              <label className="flex cursor-not-allowed items-center gap-2 text-sm text-ink-500 dark:text-umber-400">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded border border-paper-300 bg-paper-100 dark:border-umber-600 dark:bg-umber-700">
                  <span className="h-2 w-2 rounded-sm bg-ink-400 dark:bg-umber-400" />
                </span>
                {t("notifications.settings_method_inapp")}
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-800 dark:text-paper-100">
                <input
                  type="checkbox"
                  checked={cadence !== "never"}
                  onChange={() => handleCadenceChange(cadence === "never" ? "1_weekly" : "never")}
                  className="accent-blush-500"
                />
                {t("notifications.settings_method_email")}
              </label>
            </div>
          </div>

          {/* Cadence — only shown when email is on */}
          {cadence !== "never" && (
            <div className="px-4 py-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-400 dark:text-umber-400">
                {t("notifications.settings_cadence_label")}
              </p>
              <div className="flex flex-col gap-1.5">
                {NOTIF_EMAIL_CADENCE_VALUES.filter((c) => c !== "never").map((c) => (
                  <label
                    key={c}
                    className="flex cursor-pointer items-center gap-2 text-sm text-ink-800 dark:text-paper-100"
                  >
                    <input
                      type="radio"
                      name="notif_cadence"
                      value={c}
                      checked={cadence === c}
                      onChange={() => handleCadenceChange(c)}
                      className="accent-blush-500"
                    />
                    {t(CADENCE_KEY_MAP[c] as Parameters<typeof t>[0])}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Focus areas */}
          <div className="px-4 py-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-400 dark:text-umber-400">
              {t("notifications.settings_focus_label")}
            </p>
            <div className="flex flex-col gap-1.5">
              {FOCUS_ITEMS.map(({ key, labelKey }) => (
                <label
                  key={key}
                  className="flex cursor-pointer items-center gap-2 text-sm text-ink-800 dark:text-paper-100"
                >
                  <input
                    type="checkbox"
                    checked={focus.includes(key)}
                    onChange={() => handleFocusToggle(key)}
                    className="accent-blush-500"
                  />
                  {t(labelKey as Parameters<typeof t>[0])}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const SURVEY_POPUP_KEY = "weddly.survey_popup_shown";

export function NotificationBell() {
  const { t } = useT();
  const navigate = useNavigate();
  const label = useLabel();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [surveyOpen, setSurveyOpen] = useState(false);
  const cancelled = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    cancelled.current = false;
    const fetchFeed = () => {
      notificationApi
        .list()
        .then((feed) => {
          if (cancelled.current) return;
          setItems(feed.items);
          setUnread(feed.unread);
          // Show the survey popup once — only if backend says there's a prompt
          // and this browser hasn't seen it yet.
          const hasSurvey = feed.items.some((i) => i.kind === "feedback_survey");
          if (hasSurvey && !localStorage.getItem(SURVEY_POPUP_KEY)) {
            localStorage.setItem(SURVEY_POPUP_KEY, "1");
            setSurveyOpen(true);
          }
        })
        .catch(() => {
          /* badge is non-critical — fail silently */
        });
    };
    fetchFeed();
    const interval = setInterval(fetchFeed, 30_000);
    return () => {
      cancelled.current = true;
      clearInterval(interval);
    };
  }, []);

  // Close the panel on any click outside the bell + panel, or on Escape (same
  // pattern the vendor and planner shells use). Replaces the old full-screen
  // backdrop button, which sat below the sticky header and so ignored clicks up
  // in the header row.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setShowSettings(false);
        setShowHistory(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setShowSettings(false);
        setShowHistory(false);
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function dismissSurvey() {
    setSurveyOpen(false);
    setItems((cur) => cur.filter((i) => i.kind !== "feedback_survey"));
    void notificationApi.surveyDismiss().catch(() => {
      /* non-critical */
    });
  }

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (!next) {
      setShowSettings(false);
      setShowHistory(false);
    }
    // Opening clears the BADGE (we've acknowledged there's something), but must
    // NOT mark the items read — an unclicked notification stays in the "new"
    // list until the user actually clicks it. Only markSeen (the watermark).
    if (next && unread > 0) {
      setUnread(0);
      void notificationApi.markSeen().catch(() => {
        /* non-critical */
      });
    }
  }

  function openItem(item: NotificationItem) {
    if (item.kind === "feedback_survey") {
      setOpen(false);
      setShowSettings(false);
      setSurveyOpen(true);
      return;
    }
    // Clicking a notification is what moves it to history — mark just this one
    // read (optimistic + persist), never the whole list.
    if (!item.read) {
      setItems((cur) => cur.map((i) => (i.id === item.id ? { ...i, read: true } : i)));
      setUnread((u) => Math.max(0, u - 1));
      void notificationApi.markRead(item.id).catch(() => {
        /* non-critical */
      });
    }
    setOpen(false);
    setShowSettings(false);
    if (item.link) navigate(item.link);
  }

  return (
    <>
      {/* One-time survey pop-up — opens automatically once after 120 actions */}
      <FeedbackDialog
        open={surveyOpen}
        onClose={dismissSurvey}
        source="app"
        context="survey_prompt"
        preface={t("notifications.feedback_survey_intro")}
      />
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={toggleOpen}
          aria-label={t("notifications.aria_label")}
          title={t("notifications.title")}
          aria-expanded={open}
          className="relative inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-700 transition-colors hover:bg-paper-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 focus-visible:ring-offset-2 dark:text-paper-200 dark:hover:bg-umber-800 dark:focus-visible:ring-paper-100"
        >
          <Bell size={18} aria-hidden="true" />
          {unread > 0 && (
            <span
              className="absolute right-1.5 top-1.5 inline-flex min-w-[16px] items-center justify-center rounded-full bg-blush-500 px-1 text-[10px] font-semibold leading-4 text-paper-50"
              aria-hidden="true"
            >
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>

        {open && (
          <div
            role="menu"
            className="absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-paper-300 bg-paper-50 shadow-pop dark:border-umber-700 dark:bg-umber-800"
          >
            {showSettings ? (
              <SettingsPanel onBack={() => setShowSettings(false)} />
            ) : (
              <>
                <div className="flex items-center justify-between border-b border-paper-200 px-4 py-3 dark:border-umber-700">
                  <p className="font-grotesk text-sm font-semibold text-ink-900 dark:text-paper-50">
                    {t("notifications.title")}
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowSettings(true)}
                    aria-label={t("notifications.settings_title")}
                    title={t("notifications.settings_title")}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-paper-200 hover:text-ink-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:text-umber-400 dark:hover:bg-umber-700 dark:hover:text-paper-100"
                  >
                    <Settings size={14} aria-hidden="true" />
                  </button>
                </div>
                {(() => {
                  const unreadItems = items.filter((i) => !i.read);
                  const readItems = items.filter((i) => i.read);
                  const visibleItems = showHistory ? items : unreadItems;
                  return (
                    <>
                      {visibleItems.length === 0 ? (
                        <p className="px-4 py-8 text-center text-sm text-ink-500 dark:text-umber-300">
                          {readItems.length > 0
                            ? t("notifications.no_new")
                            : t("notifications.empty")}
                        </p>
                      ) : (
                        <ul className="max-h-96 divide-y divide-paper-200 overflow-y-auto dark:divide-umber-700">
                          {visibleItems.map((item) => {
                            const Icon = KIND_ICON[item.kind] ?? Bell;
                            const overdue = item.kind === "timeline_overdue";
                            return (
                              <li key={item.id}>
                                <button
                                  type="button"
                                  onClick={() => openItem(item)}
                                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-paper-100/60 focus:outline-none focus-visible:bg-paper-100 dark:hover:bg-umber-900/40 dark:focus-visible:bg-umber-900/60"
                                >
                                  <span
                                    className={`mt-0.5 shrink-0 ${overdue ? "text-blush-600 dark:text-blush-300" : "text-ink-400 dark:text-umber-300"}`}
                                  >
                                    <Icon size={16} aria-hidden="true" />
                                  </span>
                                  <span
                                    className={`min-w-0 flex-1 text-sm ${item.read ? "text-ink-600 dark:text-umber-200" : "font-medium text-ink-900 dark:text-paper-50"}`}
                                  >
                                    {label(item)}
                                  </span>
                                  {!item.read && (
                                    <span
                                      className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blush-500"
                                      aria-hidden="true"
                                    />
                                  )}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {readItems.length > 0 && (
                        <div className="border-t border-paper-200 px-4 py-2 dark:border-umber-700">
                          <button
                            type="button"
                            onClick={() => setShowHistory((v) => !v)}
                            className="w-full text-center text-xs text-ink-400 transition-colors hover:text-ink-700 dark:text-umber-400 dark:hover:text-paper-100"
                          >
                            {showHistory
                              ? t("notifications.hide_history")
                              : t("notifications.show_history")}
                          </button>
                        </div>
                      )}
                    </>
                  );
                })()}
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
