import { PublicShell } from "../components/PublicShell";
import { useT } from "../lib/i18n";
import en from "../locales/en";
import hu from "../locales/hu";
import { useDocumentMeta } from "../lib/seo";
import { BackLink, H2, LegalHeader, LegalSection, SecondaryLanguageDivider } from "./PrivacyPage";

/**
 * /about — who built Weddly, why, and how to reach them. The founder
 * name lives in `about.founder_placeholder` per locale and is templated
 * into `paragraph_made_in` via the `{founder}` token.
 */
export default function AboutPage() {
  const { t } = useT();
  useDocumentMeta("about.seo_title", "about.seo_description");

  return (
    <PublicShell>
      <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-20">
        <LegalHeader
          title={t("about.page_title")}
          updatedLabel={t("about.last_updated_label")}
          updatedDate={t("about.last_updated_date")}
        />
        <AboutBodyForLocale strings={hu.about} sectionLocale="hu" />
        <SecondaryLanguageDivider label="English" />
        <AboutBodyForLocale strings={en.about} sectionLocale="en" secondary />
        <BackLink />
      </article>
    </PublicShell>
  );
}

function AboutBodyForLocale({
  strings,
  sectionLocale,
  secondary,
}: {
  strings: typeof hu.about;
  sectionLocale: "hu" | "en";
  secondary?: boolean;
}) {
  // `paragraph_made_in` has a `{founder}` placeholder; we substitute it
  // with the locale's own founder_placeholder string so HU and EN read
  // the same value style.
  const madeIn = strings.paragraph_made_in.replace("{founder}", strings.founder_placeholder);
  return (
    <LegalSection sectionLocale={sectionLocale} secondary={secondary}>
      <p>{madeIn}</p>
      <p>{strings.paragraph_why}</p>

      <H2>{strings.paragraph_principles_title}</H2>
      <ul className="ml-5 list-disc space-y-2">
        <li>{strings.principle_calm}</li>
        <li>{strings.principle_no_lock_in}</li>
        <li>{strings.principle_hungarian}</li>
      </ul>

      <H2>{strings.paragraph_contact_label}</H2>
      <p>
        <a
          href={`mailto:${strings.paragraph_contact_email}`}
          className="underline hover:text-ink-900"
        >
          {strings.paragraph_contact_email}
        </a>
      </p>
    </LegalSection>
  );
}
