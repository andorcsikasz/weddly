import { Calendar, Heart, Users } from "lucide-react";
import type { JSX } from "react";
import { Link } from "react-router-dom";
import { Shell } from "../components/Shell";
import { useT } from "../lib/i18n";

export default function LandingPage() {
  const { t } = useT();
  return (
    <Shell>
      <section className="mx-auto max-w-3xl py-12 text-center sm:py-20">
        <h1 className="font-serif text-4xl leading-tight tracking-tight sm:text-6xl">
          {t("landing.hero_title")}
        </h1>
        <p className="mt-6 text-base text-ink-600 sm:text-lg">{t("landing.hero_sub")}</p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link to="/signup" className="btn-primary btn-lg w-full sm:w-auto">
            {t("landing.cta_signup")}
          </Link>
          <Link to="/login" className="btn-outline btn-lg w-full sm:w-auto">
            {t("landing.cta_login")}
          </Link>
        </div>
      </section>

      <section className="mt-12 grid gap-4 sm:grid-cols-3">
        <FeatureCard
          icon={<Calendar size={20} />}
          title={t("landing.feature_planning_title")}
          body={t("landing.feature_planning_body")}
        />
        <FeatureCard
          icon={<Users size={20} />}
          title={t("landing.feature_guests_title")}
          body={t("landing.feature_guests_body")}
        />
        <FeatureCard
          icon={<Heart size={20} />}
          title={t("landing.feature_seating_title")}
          body={t("landing.feature_seating_body")}
        />
      </section>
    </Shell>
  );
}

function FeatureCard({ icon, title, body }: { icon: JSX.Element; title: string; body: string }) {
  return (
    <article className="card-hover">
      <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-blush-100 text-blush-700">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-ink-900">{title}</h3>
      <p className="mt-1 text-sm text-ink-600">{body}</p>
    </article>
  );
}
