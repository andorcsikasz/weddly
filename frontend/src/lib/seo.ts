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

function setCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.rel = "canonical";
    document.head.appendChild(el);
  }
  el.href = href;
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
 * Title-only variant for authenticated in-app surfaces (vendor/planner
 * workspaces): no description/og rewrites because these pages are never
 * crawled, but each route still deserves its own tab title instead of the
 * marketing tagline. Pass the already-translated page name; the brand
 * suffix is appended here so every call site stays consistent.
 */
export function useDocumentTitle(pageName: string) {
  useEffect(() => {
    document.title = `${pageName} · Wēddly`;
  }, [pageName]);
}

/**
 * Literal-string variant for pages whose title/description aren't fixed
 * i18n keys (e.g. /blog/:slug, where the meta comes from the post record
 * the page resolved at runtime). Same DOM writes as `useDocumentMeta`; the
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

/** Keeps the browser head correct after client-side navigation between public
 * marketing pages. Direct requests receive the same values from the server
 * renderer, so crawlers do not depend on this effect. */
export function usePublicPageMeta(title: string, description: string, path: string) {
  useEffect(() => {
    const canonical = `https://tryweddly.com${path}`;
    document.title = title;
    setCanonical(canonical);
    setMeta("description", description);
    setMeta("robots", "index,follow");
    setMeta("og:locale", "hu_HU", "property");
    setMeta("og:url", canonical, "property");
    setMeta("og:title", title, "property");
    setMeta("og:description", description, "property");
    setMeta("og:image", "https://tryweddly.com/og.png", "property");
    setMeta("twitter:card", "summary_large_image");
    setMeta("twitter:title", title);
    setMeta("twitter:description", description);
    setMeta("twitter:image", "https://tryweddly.com/og.png");
  }, [title, description, path]);
}
