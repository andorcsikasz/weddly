// Landing pages for the emailed newsletter links: /newsletter/confirm/:token
// flips a pending double-opt-in subscription to confirmed;
// /newsletter/unsubscribe/:token records a suppression. Both consume the
// token on mount and render a single outcome card.

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PublicShell } from "../components/PublicShell";
import { ApiError } from "../lib/api";
import { newsletterApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

type Outcome = "working" | "success" | "expired" | "invalid";

export default function NewsletterConfirmPage({ mode }: { mode: "confirm" | "unsubscribe" }) {
  const { t } = useT();
  const { token } = useParams<{ token: string }>();
  const [outcome, setOutcome] = useState<Outcome>("working");

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!token) {
        setOutcome("invalid");
        return;
      }
      try {
        if (mode === "confirm") await newsletterApi.confirm(token);
        else await newsletterApi.unsubscribe(token);
        if (!cancelled) setOutcome("success");
      } catch (err) {
        if (cancelled) return;
        const expired = err instanceof ApiError && err.status === 410;
        setOutcome(mode === "confirm" && expired ? "expired" : "invalid");
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [token, mode]);

  const title =
    outcome === "working"
      ? t("newsletter.confirm_working")
      : outcome === "success"
        ? mode === "confirm"
          ? t("newsletter.confirm_success_title")
          : t("newsletter.unsub_success_title")
        : outcome === "expired"
          ? t("newsletter.confirm_expired_title")
          : t("newsletter.confirm_invalid_title");

  const body =
    outcome === "working"
      ? null
      : outcome === "success"
        ? mode === "confirm"
          ? t("newsletter.confirm_success_body")
          : t("newsletter.unsub_success_body")
        : outcome === "expired"
          ? t("newsletter.confirm_expired_body")
          : t("newsletter.confirm_invalid_body");

  return (
    <PublicShell>
      <section className="mx-auto flex max-w-xl flex-col items-start px-4 py-20 sm:px-6 sm:py-28">
        <h1
          aria-live="polite"
          className="font-grotesk text-2xl font-semibold text-umber-900 dark:text-paper-50 sm:text-3xl"
        >
          {title}
        </h1>
        {body && (
          <p className="mt-3 font-grotesk text-base leading-relaxed text-umber-700 dark:text-umber-200">
            {body}
          </p>
        )}
        {outcome !== "working" && (
          <Link to="/" className="btn-primary mt-8">
            {t("newsletter.back_home")}
          </Link>
        )}
      </section>
    </PublicShell>
  );
}
