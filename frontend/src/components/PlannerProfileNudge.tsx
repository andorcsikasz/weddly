// "Your public profile is still thin" — the planner-portal counterpart to what
// a couple actually meets at /app/planners/:id.
//
// The three showcase sections (photos, packages, availability) render only when
// they have content, so a planner who filled in every text field can still ship
// a page that is a monogram tile over three collapsed sections and no rating.
// Nothing in the portal said so: `profile_complete` measures the four listing
// fields, and it is deliberately not widened here, because that flag fills the
// admin's verified badge and raising its bar would hollow the check on every
// planner who already earned it.
//
// Not dismissible, and that is the point — it disappears by being finished. It
// renders nothing once every item is done.

import { Camera, CalendarDays, Check, Tag } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { Link } from "react-router-dom";
import type { PlannerProfileChecklist } from "@shared/types";
import { useT } from "../lib/i18n";

type Item = {
  key: keyof PlannerProfileChecklist;
  labelKey: string;
  to: string;
  icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;
};

// Photos live on the account tab (next to the rest of the public profile);
// packages and the calendar live on offerings.
const ITEMS: Item[] = [
  {
    key: "has_photo",
    labelKey: "planner_profile.nudge_photo",
    to: "/app/planner/settings/account",
    icon: Camera,
  },
  {
    key: "has_package",
    labelKey: "planner_profile.nudge_package",
    to: "/app/planner/settings/offerings",
    icon: Tag,
  },
  {
    key: "has_availability",
    labelKey: "planner_profile.nudge_availability",
    to: "/app/planner/settings/offerings",
    icon: CalendarDays,
  },
];

export function PlannerProfileNudge({ checklist }: { checklist: PlannerProfileChecklist }) {
  const { t } = useT();
  const missing = ITEMS.filter((i) => !checklist[i.key]);
  if (missing.length === 0) return null;

  return (
    <section className="card p-5">
      <h2 className="font-grotesk text-lg font-semibold text-umber-900 dark:text-paper-50">
        {t("planner_profile.nudge_title")}
      </h2>
      <p className="mt-1 text-sm text-umber-600 dark:text-umber-300">
        {t("planner_profile.nudge_body")}
      </p>
      <ul className="mt-4 space-y-1">
        {ITEMS.map((item) => {
          const done = checklist[item.key];
          const Icon = item.icon;
          return (
            <li key={item.key} className="flex items-center gap-3 rounded-lg px-1 py-2">
              {done ? (
                <Check size={18} className="shrink-0 text-moss-600 dark:text-moss-400" />
              ) : (
                <Icon
                  size={18}
                  strokeWidth={1.5}
                  className="shrink-0 text-umber-400 dark:text-umber-500"
                />
              )}
              <span
                className={`flex-1 text-sm ${
                  done
                    ? "text-umber-400 dark:text-umber-500"
                    : "font-medium text-umber-800 dark:text-paper-100"
                }`}
              >
                {t(item.labelKey)}
              </span>
              {!done && (
                <Link to={item.to} className="btn-outline btn-sm shrink-0">
                  {t("planner_profile.nudge_cta")}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
