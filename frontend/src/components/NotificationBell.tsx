// Top-bar notification bell. Polls the merged feed (live timeline items +
// stored events) every 30s, shows an unread badge, and drops a panel listing
// what needs attention. Opening the panel stamps the read watermark (per-user,
// so it never clears the partner's badge) and optimistically zeroes the badge —
// the same optimistic-then-roundtrip shape AppShell already uses for admin
// section badges. Labels are composed here via t() from kind + data, so the
// stored payload never freezes locale.

import type { NotificationItem } from "@shared/notifications";
import { AlertTriangle, Bell, CalendarClock, ClipboardList, Mail, Send } from "lucide-react";
import { type ComponentType, type SVGProps, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { notificationApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

type IconCmp = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;

const KIND_ICON: Record<NotificationItem["kind"], IconCmp> = {
  timeline_overdue: AlertTriangle,
  timeline_due: CalendarClock,
  rsvp_received: Mail,
  rsvp_received_household: Mail,
  partner_task_added: ClipboardList,
  timeline_email_sent: Send,
};

/** Compose the human label for a feed row from its kind + params. All copy goes
 *  through t() so HU/EN both render correctly regardless of when the row was
 *  written. */
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
        return d.actorName
          ? t("notifications.partner_task_added_named", { name: String(d.actorName) })
          : t("notifications.partner_task_added");
      case "timeline_email_sent":
        return t("notifications.timeline_email_sent");
      default:
        return "";
    }
  };
}

export function NotificationBell() {
  const { t } = useT();
  const navigate = useNavigate();
  const label = useLabel();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    const fetchFeed = () => {
      notificationApi
        .list()
        .then((feed) => {
          if (cancelled.current) return;
          setItems(feed.items);
          setUnread(feed.unread);
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

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      // Optimistic zero — the server roundtrip catches up in <100ms; the items
      // stay visible (still actionable), the badge just clears for this user.
      setUnread(0);
      setItems((cur) => cur.map((i) => ({ ...i, read: true })));
      void notificationApi.markSeen().catch(() => {
        /* non-critical — the next 30s poll re-syncs */
      });
    }
  }

  function openItem(item: NotificationItem) {
    setOpen(false);
    if (item.link) navigate(item.link);
  }

  return (
    <div className="relative">
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
        <>
          {/* Outside-click catcher. */}
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="fixed inset-0 z-30 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-paper-300 bg-paper-50 shadow-pop dark:border-umber-700 dark:bg-umber-800"
          >
            <div className="border-b border-paper-200 px-4 py-3 dark:border-umber-700">
              <p className="font-grotesk text-sm font-semibold text-ink-900 dark:text-paper-50">
                {t("notifications.title")}
              </p>
            </div>
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-ink-500 dark:text-umber-300">
                {t("notifications.empty")}
              </p>
            ) : (
              <ul className="max-h-96 divide-y divide-paper-200 overflow-y-auto dark:divide-umber-700">
                {items.map((item) => {
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
          </div>
        </>
      )}
    </div>
  );
}
