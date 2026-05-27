import { useEffect } from "react";
import { useT } from "./i18n";

function setMeta(name: string, content: string, attr: "name" | "property" = "name") {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

/**
 * Updates document.title + description/og/twitter meta from i18n keys.
 * Pass keys (not literals) so the values track the active locale.
 */
export function useDocumentMeta(titleKey: string, descriptionKey: string) {
  const { t, locale } = useT();
  useEffect(() => {
    const title = t(titleKey);
    const description = t(descriptionKey);
    document.title = title;
    setMeta("description", description);
    setMeta("og:title", title, "property");
    setMeta("og:description", description, "property");
    setMeta("twitter:title", title);
    setMeta("twitter:description", description);
  }, [t, locale, titleKey, descriptionKey]);
}

/**
 * Literal-string variant for pages whose title/description aren't fixed
 * i18n keys — e.g. /blog/:slug, where the meta comes from the post record
 * the page resolved at runtime. Same DOM writes as `useDocumentMeta`; the
 * caller is responsible for picking the right locale's string.
 */
export function useDocumentMetaLiteral(title: string, description: string) {
  useEffect(() => {
    document.title = title;
    setMeta("description", description);
    setMeta("og:title", title, "property");
    setMeta("og:description", description, "property");
    setMeta("twitter:title", title);
    setMeta("twitter:description", description);
  }, [title, description]);
}
