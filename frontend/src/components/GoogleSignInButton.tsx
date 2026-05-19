// "Continue with Google" button. Loads Google Identity Services on demand,
// renders Google's official button into the placeholder div, and hands the
// returned credential JWT to the backend for verification.
//
// VITE_GOOGLE_CLIENT_ID is baked at build time; when it's missing (local dev
// without a Cloud Console project) the component renders nothing so the
// password form stays usable.

import { PRIVACY_VERSION, TERMS_VERSION } from "@shared/legal";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { authApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useToast } from "./ui";

const GSI_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

// Module-level cache so React strict-mode double-mounts and per-page mounts
// don't reload the script. Resolves the moment `window.google.accounts.id`
// is available.
let gsiReady: Promise<void> | null = null;

function loadGsi(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  const w = window as unknown as { google?: { accounts?: { id?: unknown } } };
  if (w.google?.accounts?.id) return Promise.resolve();
  if (gsiReady) return gsiReady;
  gsiReady = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load GSI")));
      return;
    }
    const s = document.createElement("script");
    s.src = GSI_SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load GSI"));
    document.head.appendChild(s);
  });
  return gsiReady;
}

interface GsiCredentialResponse {
  credential: string;
}

interface GsiAccountsId {
  initialize: (opts: {
    client_id: string;
    callback: (resp: GsiCredentialResponse) => void;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
    /** Modern (Chrome 117+) replacement for third-party cookies in One Tap.
     *  When true, GSI uses the browser's Federated Credential Management
     *  API; falls back automatically on browsers that don't support it. */
    use_fedcm_for_prompt?: boolean;
    /** Where to anchor the One Tap UI. "right" matches Google's docs. */
    prompt_parent_id?: string;
  }) => void;
  renderButton: (
    el: HTMLElement,
    opts: {
      type?: "standard" | "icon";
      theme?: "outline" | "filled_blue" | "filled_black";
      size?: "large" | "medium" | "small";
      text?: "signin_with" | "signup_with" | "continue_with" | "signin";
      shape?: "rectangular" | "pill" | "circle" | "square";
      logo_alignment?: "left" | "center";
      width?: number;
      locale?: string;
    },
  ) => void;
  /** Shows the One Tap dialog. The callback (optional, deprecated in FedCM
   *  mode) reports why a prompt didn't appear — useful for diagnostics. */
  prompt: (cb?: (n: PromptNotification) => void) => void;
  /** Dismisses the One Tap dialog (no-op when nothing is open). */
  cancel: () => void;
  /** Tells GSI the user explicitly signed out so the next visit doesn't
   *  auto_select them back in. */
  disableAutoSelect: () => void;
}

interface PromptNotification {
  isNotDisplayed?: () => boolean;
  isSkippedMoment?: () => boolean;
  isDismissedMoment?: () => boolean;
  getNotDisplayedReason?: () => string;
  getSkippedReason?: () => string;
  getDismissedReason?: () => string;
}

function getGsi(): GsiAccountsId | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { google?: { accounts?: { id?: GsiAccountsId } } };
  return w.google?.accounts?.id ?? null;
}

interface Props {
  /** Affects the label on Google's button: "signup_with" on the register page,
   *  "signin_with" on the login page. Pure cosmetics; the backend handles
   *  both new-account and existing-account flows. */
  mode: "signup" | "signin";
  /** Where to send the user after a successful auth. Defaults to /app. */
  redirectTo?: string;
  /** Also pop Google's One Tap dialog after init. Use on the login page so a
   *  returning visitor signed into Google in this browser is offered their
   *  account without clicking the button. */
  oneTap?: boolean;
  /** When true (and oneTap is on), Google silently re-issues a credential
   *  for the previously-used account on subsequent visits — same UX as
   *  Gmail's "Stay signed in". Has no effect on first-time users. */
  autoSelect?: boolean;
}

const CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "") as string;

export function GoogleSignInButton({
  mode,
  redirectTo = "/app",
  oneTap = false,
  autoSelect = false,
}: Props) {
  const { t, locale } = useT();
  const { setSession } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!CLIENT_ID) {
      // Dev hint — usually means VITE_GOOGLE_CLIENT_ID is missing OR the Vite
      // dev server was started before frontend/.env existed (Vite reads .env
      // once at boot, never on HMR). Production builds bake the value at
      // build time so a missing var there is a deploy-config bug.
      if (import.meta.env.DEV) {
        console.warn(
          "[GoogleSignInButton] VITE_GOOGLE_CLIENT_ID is empty. Restart `bun run dev:frontend` after editing frontend/.env.",
        );
      }
      setHidden(true);
      return;
    }
    let cancelled = false;

    loadGsi()
      .then(() => {
        if (cancelled) return;
        const gsi = getGsi();
        if (!gsi || !hostRef.current) return;

        gsi.initialize({
          client_id: CLIENT_ID,
          callback: async (resp) => {
            if (cancelled) return;
            try {
              const session = await authApi.google({
                credential: resp.credential,
                privacy_version: PRIVACY_VERSION,
                terms_version: TERMS_VERSION,
              });
              setSession(session.token, session.user);
              navigate(redirectTo, { replace: true });
            } catch (err) {
              const msg =
                err instanceof ApiError
                  ? err.status === 429
                    ? t("auth.rate_limited")
                    : err.status === 503
                      ? t("auth.google_unavailable")
                      : t("auth.google_failed")
                  : t("auth.google_failed");
              toast.error(msg);
            }
          },
          auto_select: autoSelect,
          cancel_on_tap_outside: true,
          // FedCM is required from Chrome 117+ — without it One Tap silently
          // falls back to third-party cookies, which are blocked by default
          // in Safari and Firefox. GSI handles the non-FedCM fallback for
          // older browsers internally.
          use_fedcm_for_prompt: true,
        });

        // Width: button stretches to host width up to GSI's max of 400. We
        // pass the measured container width so the button matches the
        // password-form button width exactly.
        const width = Math.min(400, hostRef.current.clientWidth || 320);
        gsi.renderButton(hostRef.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: mode === "signup" ? "signup_with" : "signin_with",
          // Pill = fully rounded edges. Matches the rest of Weddly's auth
          // surfaces, which use generous radii on primary CTAs.
          shape: "pill",
          // Centred logo + text reads more like a branded CTA than the
          // left-aligned default (which leaves a big gap of whitespace
          // between the G and the label at the button's full width).
          logo_alignment: "center",
          width,
          locale: locale === "hu" ? "hu_HU" : "en_US",
        });

        // One Tap fires the floating prompt (top-right by default) so a
        // returning user signed into Google in this browser gets a
        // single-tap option without clicking the button. With autoSelect
        // it short-circuits to a silent credential issuance — same UX as
        // Gmail's seamless re-signin. Honours its own cooldown rules: if
        // the user dismissed three prompts recently, Google won't show it
        // again for a few hours, and we get a notification.
        if (oneTap) {
          gsi.prompt((n) => {
            if (import.meta.env.DEV) {
              const reasons: string[] = [];
              if (n.isNotDisplayed?.())
                reasons.push(`not_displayed:${n.getNotDisplayedReason?.()}`);
              if (n.isSkippedMoment?.()) reasons.push(`skipped:${n.getSkippedReason?.()}`);
              if (n.isDismissedMoment?.()) reasons.push(`dismissed:${n.getDismissedReason?.()}`);
              if (reasons.length > 0) console.debug("[gsi] one-tap", reasons.join(" "));
            }
          });
        }
      })
      .catch(() => {
        if (!cancelled) setHidden(true);
      });

    return () => {
      cancelled = true;
      // Dismiss any open One Tap when the user navigates away from /login
      // — otherwise the floating dialog can outlive its page.
      getGsi()?.cancel();
    };
  }, [mode, redirectTo, oneTap, autoSelect, locale, navigate, setSession, t, toast]);

  if (hidden) return null;
  // Min-height matches Google's "large" button so the layout doesn't jump
  // while the script loads.
  return <div ref={hostRef} className="flex min-h-[44px] w-full justify-center" />;
}
