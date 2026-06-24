import { CalendarRange, ClipboardList, Users } from "lucide-react";
import { useEffect, useState } from "react";
import type { PlannerClientView } from "@shared/types";
import { plannerApi } from "../lib/endpoints";
import { useAuth } from "../lib/auth";
import { useT } from "../lib/i18n";
import { formatDate } from "../lib/format";

interface FeatureTile {
  icon: React.ElementType;
  name: string;
  desc: string;
}

export default function PlannerHomePage() {
  const { user, logout } = useAuth();
  const { t, locale } = useT();

  const [clients, setClients] = useState<PlannerClientView[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [addStatus, setAddStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [addError, setAddError] = useState("");
  const [enteringId, setEnteringId] = useState<number | null>(null);

  useEffect(() => {
    plannerApi
      .listClients()
      .then((r) => setClients(r.clients))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleAddClient(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setAddStatus("loading");
    setAddError("");
    try {
      await plannerApi.addClient(email.trim());
      const r = await plannerApi.listClients();
      setClients(r.clients);
      setEmail("");
      setAddStatus("ok");
    } catch (err) {
      setAddStatus("error");
      setAddError(err instanceof Error ? err.message : t("planner_home.add_client_error"));
    }
  }

  async function handleEnter(coupleId: number) {
    setEnteringId(coupleId);
    try {
      await plannerApi.enterClient(coupleId);
      window.location.assign("/app");
    } catch {
      setEnteringId(null);
    }
  }

  const tiles: FeatureTile[] = [
    {
      icon: Users,
      name: t("planner_home.feature_clients"),
      desc: t("planner_home.feature_clients_desc"),
    },
    {
      icon: CalendarRange,
      name: t("planner_home.feature_timeline"),
      desc: t("planner_home.feature_timeline_desc"),
    },
    {
      icon: ClipboardList,
      name: t("planner_home.feature_runsheet"),
      desc: t("planner_home.feature_runsheet_desc"),
    },
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
          <p className="mt-2 text-umber-500 dark:text-umber-400">{t("planner_home.subtitle")}</p>
        </div>

        {/* Client roster */}
        <section className="mb-12">
          <h2 className="mb-4 font-grotesk text-lg font-medium text-umber-800 dark:text-paper-200">
            {t("planner_home.clients_roster_heading")}
          </h2>

          {loading ? (
            <div className="space-y-3">
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className="h-20 animate-pulse rounded-xl border border-paper-200 bg-paper-100 dark:border-umber-800 dark:bg-umber-800"
                />
              ))}
            </div>
          ) : clients.length === 0 ? (
            <div className="rounded-xl border border-paper-200 bg-white px-6 py-10 text-center dark:border-umber-800 dark:bg-umber-900">
              <Users className="mx-auto mb-3 h-8 w-8 text-paper-300 dark:text-umber-700" />
              <p className="text-sm text-umber-400 dark:text-umber-500">
                {t("planner_home.clients_empty")}
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {clients.map((c) => (
                <div
                  key={c.couple_id}
                  className="flex items-start justify-between rounded-xl border border-paper-200 bg-white px-5 py-4 dark:border-umber-800 dark:bg-umber-900"
                >
                  <div className="min-w-0">
                    <p className="truncate font-grotesk font-semibold text-umber-900 dark:text-paper-50">
                      {c.display_name}
                    </p>
                    <p className="mt-0.5 text-xs text-umber-500 dark:text-umber-400">
                      {c.wedding_date
                        ? formatDate(c.wedding_date, locale)
                        : t("planner_home.client_wedding_date_none")}
                      {" · "}
                      {t("planner_home.client_guests").replace(
                        "{{count}}",
                        String(c.confirmed_guests),
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleEnter(c.couple_id)}
                    disabled={enteringId !== null}
                    className="btn-outline btn-sm ml-4 shrink-0"
                  >
                    {enteringId === c.couple_id
                      ? "…"
                      : t("planner_home.enter_workspace")}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add client form */}
          <div className="mt-6 rounded-xl border border-paper-200 bg-white px-5 py-5 dark:border-umber-800 dark:bg-umber-900">
            <p className="mb-3 font-grotesk text-sm font-semibold text-umber-800 dark:text-paper-200">
              {t("planner_home.add_client_heading")}
            </p>
            <form onSubmit={(e) => void handleAddClient(e)} className="flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (addStatus !== "idle") setAddStatus("idle");
                }}
                placeholder={t("planner_home.add_client_placeholder")}
                className="input flex-1 text-sm"
                disabled={addStatus === "loading"}
              />
              <button
                type="submit"
                disabled={addStatus === "loading" || !email.trim()}
                className="btn-primary btn-sm shrink-0"
              >
                {t("planner_home.add_client_button")}
              </button>
            </form>
            {addStatus === "ok" && (
              <p className="mt-2 text-xs text-sage-600">{t("planner_home.add_client_success")}</p>
            )}
            {addStatus === "error" && (
              <p className="mt-2 text-xs text-red-500">{addError}</p>
            )}
          </div>
        </section>

        {/* Coming-soon feature tiles */}
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
