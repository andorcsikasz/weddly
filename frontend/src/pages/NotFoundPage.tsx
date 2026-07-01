import { Link } from "react-router-dom";
import { Shell } from "../components/Shell";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

/** `bare` renders just the message block (no public Shell) so the page can sit
 *  inside an authenticated layout (e.g. the planner sidebar shell) without
 *  nesting two page chromes. `homeTo` points the CTA at that area's own home. */
export default function NotFoundPage({
  bare = false,
  homeTo = "/",
}: { bare?: boolean; homeTo?: string }) {
  const { t } = useT();
  useDocumentMeta("seo.notfound_title", "seo.notfound_description");
  const content = (
    <div className="mx-auto mt-16 max-w-md text-center">
      <h1 className="text-3xl sm:text-4xl">{t("notfound.title")}</h1>
      <p className="mt-3 text-ink-600 dark:text-umber-300">{t("notfound.body")}</p>
      <Link to={homeTo} className="btn-primary mt-6 inline-block">
        {t("notfound.go_home")}
      </Link>
    </div>
  );
  if (bare) return content;
  return <Shell>{content}</Shell>;
}
