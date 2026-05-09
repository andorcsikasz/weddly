import { Link } from "react-router-dom";
import { Shell } from "../components/Shell";
import { useT } from "../lib/i18n";

export default function NotFoundPage() {
  const { t } = useT();
  return (
    <Shell>
      <div className="mx-auto mt-16 max-w-md text-center">
        <h1 className="text-3xl">{t("notfound.title")}</h1>
        <p className="mt-3 text-ink-600">{t("notfound.body")}</p>
        <Link to="/" className="btn-primary mt-6 inline-block">
          {t("notfound.go_home")}
        </Link>
      </div>
    </Shell>
  );
}
