// Domain logic for the "share Weddly" referral prompt: which language the
// experience speaks, which message variants exist, and how each step reaches
// the growth funnel. The component (components/ShareWeddlyDialog.tsx) stays a
// view on top of this.

import type { GrowthEventKind, ShareWeddlyAnalyticsEvent } from "@shared/growth";
import { growthApi } from "./endpoints";
import type { Locale } from "./i18n";

/** The one URL the share message points at. Also the `url` handed to
 *  `navigator.share`. */
export const SHARE_URL = "https://tryweddly.com";

const SHARE_KIND: GrowthEventKind = "share.weddly";

/** Message variants, in display order. The first is selected by default in
 *  both languages. */
export const SHARE_VARIANTS = ["warm", "clean", "friendly"] as const;
export type ShareVariant = (typeof SHARE_VARIANTS)[number];

/** How the modal was opened. */
export type ShareSource = "automatic_popup" | "profile_dropdown";

/** Which language the whole experience speaks.
 *
 *  The rule we were given is "English if the interface is English, Hungarian
 *  for every other language, Hungarian when the locale can't be resolved".
 *  Weddly's interface is only ever `hu` or `en`, so that collapses to this
 *  one-liner — but it is written as an explicit non-`en` → `hu` fallback
 *  rather than `locale === "hu"` so adding a third UI language later lands on
 *  Hungarian by default instead of silently leaking English copy.
 *
 *  It also matches `useT()`'s own out-of-provider fallback, which is `hu`. */
export function shareLanguage(locale: Locale | null | undefined): "en" | "hu" {
  return locale === "en" ? "en" : "hu";
}

/** i18n key for a variant's message body. Both trees carry all three, so the
 *  modal loads every option in the active language when it OPENS — nothing is
 *  translated at share time. */
export function variantMessageKey(variant: ShareVariant): string {
  return `share_weddly.message_${variant}`;
}

/** i18n key for a variant's short label ("Warm" / "Kedves"). */
export function variantLabelKey(variant: ShareVariant): string {
  return `share_weddly.variant_${variant}`;
}

/** `navigator.share` availability. Checked at call time rather than cached:
 *  the answer is stable per browser, but an SSR/happy-dom render must not bake
 *  in `false` for a real browser that hydrates later. */
export function canNativeShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

/** The message copy already ends with the URL, and `navigator.share` renders
 *  `text` and `url` together — passing both verbatim makes tryweddly.com show
 *  up twice in WhatsApp, Messages and every other target. So we strip the
 *  trailing URL out of the text and let the `url` field carry it, which also
 *  gives the target app a real link to unfurl. */
export function splitShareMessage(message: string): { text: string; url: string } {
  const text = message
    .replace(SHARE_URL, "")
    .replace(/[\s:,–-]+$/u, "")
    .trim();
  return { text, url: SHARE_URL };
}

/** Everything a clipboard copy should carry: the message exactly as the user
 *  read it on the card, URL included. */
export function clipboardMessage(message: string): string {
  return message.trim();
}

/** Dimensions attached to every funnel event. Deliberately free of anything
 *  identifying a wedding — no names, dates, guest counts, or the couple's own
 *  share slug. Counters and enums only. */
export interface ShareAnalyticsContext {
  source: ShareSource;
  language: "en" | "hu";
  message_variant?: ShareVariant;
  share_method?: "native_share" | "clipboard_fallback" | "copy_button";
  user_session_number?: number;
  meaningful_actions_completed?: number;
}

/** Ping one step of the share funnel. Never throws, never awaits anything the
 *  UI depends on. */
export function trackShare(event: ShareWeddlyAnalyticsEvent, ctx: ShareAnalyticsContext): void {
  void growthApi.record(SHARE_KIND, { event, ...ctx });
}
