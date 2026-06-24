import { CalendarRange, ClipboardList, Users } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useT } from "../lib/i18n";

interface FeatureTile {
  icon: React.ElementType;
  name: string;
  desc: string;
}

export default function PlannerHomePage() {
  const { user, logout } = useAuth();
  const { t } = useT();

  const tiles: FeatureTile[] = [
    { icon: Users, name: t("planner_home.feature_clients"), desc: t("planner_home.feature_clients_desc") },
    { icon: CalendarRange, name: t("planner_home.feature_timeline"), desc: t("planner_home.feature_timeline_desc") },
    { icon: ClipboardList, name: t("planner_home.feature_runsheet"), desc: t("planner_home.feature_runsheet_desc") },
  ];

  return (
    <div className="min-h-screen bg-paper-50 dark:bg-umber-950">
      <header className="border-b border-paper-200 bg-white px-4 py-4 dark:border-umber-800 dark:bg-umber-900 sm:px-8">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <span className="font-cormorant text-xl font-semibold italic text-umber-900 dark:text-paper-50">
            Weddly
          </span>
          <button
            type="button"
            onClick={() => void logout()}
            className="text-sm text-umber-500 hover:text-umber-700 dark:text-umber-400 dark:hover:text-paper-200"
          >
            {t("planner_home.logout")}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-8">
        <div className="mb-10">
          <h1 className="font-grotesk text-3xl font-semibold tracking-tight text-umber-900 dark:text-paper-50">
            {t("planner_home.welcome").replace("{{name}}", user?.full_name.split(" ")[0] ?? "")}
          </h1>
          <p className="mt-2 text-umber-500 dark:text-umber-400">
            {t("planner_home.subtitle")}
          </p>
        </div>

        <section className="mb-12">
          <h2 className="mb-4 font-grotesk text-lg font-medium text-umber-800 dark:text-paper-200">
            {t("planner_home.clients_heading")}
          </h2>
          <div className="rounded-xl border border-paper-200 bg-white px-6 py-10 text-center dark:border-umber-800 dark:bg-umber-900">
            <Users className="mx-auto mb-3 h-8 w-8 text-paper-300 dark:text-umber-700" />
            <p className="text-sm text-umber-400 dark:text-umber-500">
              {t("planner_home.clients_empty")}
            </p>
          </div>
        </section>

        <section>
          <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-umber-400 dark:text-umber-600">
            {t("planner_home.coming_soon")}
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            {tiles.map(({ icon: Icon, name, desc }) => (
              <div
                key={name}
                className="rounded-xl border border-paper-200 bg-white px-5 py-6 dark:border-umber-800 dark:bg-umber-900"
              >
                <Icon className="mb-3 h-5 w-5 text-umber-400 dark:text-umber-500" />
                <p className="font-grotesk text-sm font-semibold text-umber-800 dark:text-paper-200">
                  {name}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-umber-500 dark:text-umber-400">
                  {desc}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
