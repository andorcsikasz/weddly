// Google Calendar connect/sync/disconnect affordance, shared by the couple
// timeline and the vendor calendar.
//
// The two flows differ only in which endpoints they call and which copy they
// use — the states (unconfigured / disconnected / connected + menu), the OAuth
// redirect-result toast, and the disconnect confirmation are identical, so they
// live here once. Extracted rather than copied when the vendor flow landed.

import {
  CalendarCheck2,
  CalendarPlus,
  ChevronDown,
  RefreshCw,
  TriangleAlert,
  Unlink,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { GoogleCalendarStatus } from "@shared/types";
import { ApiError } from "../lib/api";
import { useT } from "../lib/i18n";
import { useConfirm } from "./ui/ConfirmDialogProvider";
import { useToast } from "./ui/ToastProvider";

/** The four endpoints a calendar flow needs. Both `googleCalendarApi` and
 *  `vendorGoogleCalendarApi` satisfy this. */
export interface GoogleCalendarApi {
  status: () => Promise<GoogleCalendarStatus>;
  connect: () => Promise<{ url: string }>;
  sync: () => Promise<GoogleCalendarStatus>;
  disconnect: () => Promise<GoogleCalendarStatus>;
}

export function GoogleCalendarConnect({
  api,
  keyPrefix,
}: {
  api: GoogleCalendarApi;
  /** i18n namespace holding the `gcal_*` keys, e.g. "timeline" or
   *  "vendor_calendar" — the two surfaces describe different things being
   *  synced, so the copy is per-surface even though the UI is not. */
  keyPrefix: string;
}) {
  const { t } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState<GoogleCalendarStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const k = (name: string) => `${keyPrefix}.${name}`;

  const refresh = useCallback(() => {
    api
      .status()
      .then(setStatus)
      .catch(() => {});
  }, [api]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Turn the OAuth redirect result (?gcal=connected|denied|error) into a toast,
  // then strip the param so a reload doesn't re-fire it. One-shot on mount.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const flag = params.get("gcal");
    if (!flag) return;
    if (flag === "connected") toast.success(t(k("gcal_toast_connected")));
    else if (flag === "denied") toast.error(t(k("gcal_toast_denied")));
    else toast.error(t(k("gcal_toast_error")));
    params.delete("gcal");
    const qs = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    refresh();
  }, []);

  // Hidden entirely until the operator has configured the integration, so an
  // unconfigured deploy shows no dead affordance.
  if (!status || !status.configured) return null;

  async function onConnect() {
    setBusy(true);
    try {
      const { url } = await api.connect();
      window.location.href = url;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
      setBusy(false);
    }
  }

  async function onSync() {
    setMenuOpen(false);
    setBusy(true);
    try {
      setStatus(await api.sync());
      toast.success(t(k("gcal_toast_synced")));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  async function onDisconnect() {
    setMenuOpen(false);
    const ok = await confirm({
      title: t(k("gcal_disconnect_title")),
      body: t(k("gcal_disconnect_body")),
      confirmLabel: t(k("gcal_disconnect_confirm")),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      setStatus(await api.disconnect());
      toast.success(t(k("gcal_toast_disconnected")));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  const pillBase =
    "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 focus-visible:ring-offset-2 disabled:opacity-60 dark:focus-visible:ring-paper-100";

  if (!status.connected) {
    return (
      <button
        type="button"
        onClick={onConnect}
        disabled={busy}
        className={`${pillBase} bg-paper-100 text-ink-700 hover:bg-paper-200 dark:bg-umber-800 dark:text-paper-100 dark:hover:bg-umber-700`}
      >
        <CalendarPlus size={15} aria-hidden="true" />
        {busy ? t(k("gcal_connecting")) : t(k("gcal_connect"))}
      </button>
    );
  }

  // Google has ended our access and only the person can restore it (revoked, or
  // the grant expired). Nothing retries out of this, so the pill stops claiming
  // "connected", which was a green tick over a sync that had been dead for
  // weeks, and turns into the one action that fixes it. Amber, not red: nothing
  // is broken or lost, the link just has to be made again.
  const needsReconnect = status.needsReconnect;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={t(k("gcal_menu_aria"))}
        title={needsReconnect ? t(k("gcal_reauth_hint")) : undefined}
        className={`${pillBase} ${
          needsReconnect
            ? "bg-amber-100 text-amber-900 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:hover:bg-amber-900/60"
            : "bg-sage-100 text-sage-800 hover:bg-sage-200 dark:bg-sage-900/40 dark:text-sage-200 dark:hover:bg-sage-900/60"
        }`}
      >
        {needsReconnect ? (
          <TriangleAlert size={15} aria-hidden="true" />
        ) : (
          <CalendarCheck2 size={15} aria-hidden="true" />
        )}
        <span>{t(k(needsReconnect ? "gcal_reauth_label" : "gcal_connected_label"))}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {menuOpen && (
        <>
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setMenuOpen(false)}
          />
          <div
            role="menu"
            className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border border-paper-200 bg-white py-1 shadow-lg dark:border-umber-700 dark:bg-umber-900"
          >
            {status.email && (
              <p className="truncate px-3 py-1.5 text-xs text-ink-500 dark:text-umber-300">
                {status.email}
              </p>
            )}
            {needsReconnect ? (
              <>
                {/* Says what happened before offering the fix, because "reconnect"
                    with no reason reads as the app being flaky. */}
                <p className="px-3 pb-1.5 text-xs text-ink-600 dark:text-umber-200">
                  {t(k("gcal_reauth_hint"))}
                </p>
                <button
                  type="button"
                  role="menuitem"
                  onClick={onConnect}
                  disabled={busy}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-ink-900 transition-colors hover:bg-paper-100 disabled:opacity-60 dark:text-paper-50 dark:hover:bg-umber-800"
                >
                  <CalendarPlus size={14} aria-hidden="true" />
                  {busy ? t(k("gcal_connecting")) : t(k("gcal_reconnect"))}
                </button>
              </>
            ) : (
              // Deliberately absent while the grant is dead: a "Sync now" that
              // cannot succeed is a button that teaches the vendor to distrust
              // the screen.
              <button
                type="button"
                role="menuitem"
                onClick={onSync}
                disabled={busy}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink-700 transition-colors hover:bg-paper-100 disabled:opacity-60 dark:text-paper-100 dark:hover:bg-umber-800"
              >
                <RefreshCw size={14} aria-hidden="true" />
                {busy ? t(k("gcal_syncing")) : t(k("gcal_sync_now"))}
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={onDisconnect}
              disabled={busy}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60 dark:text-red-400 dark:hover:bg-red-950/40"
            >
              <Unlink size={14} aria-hidden="true" />
              {t(k("gcal_disconnect"))}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
