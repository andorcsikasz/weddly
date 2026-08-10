import { useContext, useEffect, useMemo, useState } from "react";
import { useT } from "../lib/i18n";
import { CollaborationActivityContext } from "./CollaborationActivity";

function relativeTime(timestamp: number, locale: string, now: number): string {
  const seconds = Math.round((timestamp - now) / 1_000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(seconds) < 60) return rtf.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
  return rtf.format(Math.round(hours / 24), "day");
}

/** Low-noise collaboration context for data-heavy pages. */
export function LastUpdatedBy({ actionPrefixes }: { actionPrefixes: string[] }) {
  const { t, locale } = useT();
  const entries = useContext(CollaborationActivityContext);
  const [now, setNow] = useState(() => Date.now());
  const prefixKey = actionPrefixes.join("|");

  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      window.clearInterval(clock);
    };
  }, []);

  const latest = useMemo(
    () => entries.find((entry) => actionPrefixes.some((prefix) => entry.action.startsWith(prefix))),
    [entries, prefixKey],
  );
  if (!latest) return null;
  const actor = latest.actor_full_name ?? t("profile.activity_actor_unknown");
  return (
    <p className="mt-0.5 text-[11px] text-ink-400 dark:text-umber-400">
      {t("common.last_updated_by", {
        name: actor,
        when: relativeTime(latest.created_at, locale, now),
      })}
    </p>
  );
}
