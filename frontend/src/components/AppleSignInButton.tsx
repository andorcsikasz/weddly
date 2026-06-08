// "Continue with Apple" button. Loads Sign in with Apple JS on demand, then
// runs Apple's popup handshake on click and hands the returned `id_token` JWT
// to the backend for verification. Mirrors GoogleSignInButton's post-auth flow
// (setSession + navigate, or onSuccess/onError when the caller drives it).
//
// VITE_APPLE_CLIENT_ID (the Apple Services ID) is baked at build time; when
// it's missing the component renders nothing so the password form stays usable.
// Apple also requires VITE_APPLE_REDIRECT_URI to exactly match a Return URL
// registered on the Services ID — it defaults to the current origin, which is
// what you register for a same-origin popup flow.

import { PRIVACY_VERSION, TERMS_VERSION } from "@shared/legal";
import type { AuthSession } from "@shared/types";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { clearDemoSessionFlag } from "../lib/demoSession";
import { authApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useToast } from "./ui";

const CLIENT_ID = (import.meta.env.VITE_APPLE_CLIENT_ID ?? "") as string;
const REDIRECT_URI = (import.meta.env.VITE_APPLE_REDIRECT_URI ?? "") as string;

// Apple serves a locale-specific bundle; we only ever need en_US / hu_HU.
function scriptSrc(locale: "hu" | "en"): string {
  const appleLocale = locale === "hu" ? "hu_HU" : "en_US";
  return `https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/${appleLocale}/appleid.auth.js`;
}

// Module-level cache so React strict-mode double-mounts and per-page mounts
// don't reload the script. Keyed by locale because the bundle URL is
// locale-specific; loading one locale is enough for AppleID to be available.
const appleReady: Map<string, Promise<void>> = new Map();

interface AppleSignInResponse {
  authorization: { id_token: string; code: string; state?: string };
  /** Present ONLY on the user's first authorization for this Services ID. */
  user?: { name?: { firstName?: string; lastName?: string }; email?: string };
}

interface AppleAuth {
  init: (opts: {
    clientId: string;
    scope: string;
    redirectURI: string;
    state?: string;
    usePopup: boolean;
  }) => void;
  signIn: () => Promise<AppleSignInResponse>;
}

function getApple(): AppleAuth | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AppleID?: { auth?: AppleAuth } };
  return w.AppleID?.auth ?? null;
}

function loadAppleJs(locale: "hu" | "en"): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  if (getApple()) return Promise.resolve();
  const src = scriptSrc(locale);
  const cached = appleReady.get(src);
  if (cached) return cached;
  const p = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load Apple JS")));
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Apple JS"));
    document.head.appendChild(s);
  });
  appleReady.set(src, p);
  return p;
}

interface Props {
  /** Cosmetic only — Apple's button copy doesn't change, both new-account and
   *  existing-account flows go through the same backend endpoint. Kept to
   *  mirror GoogleSignInButton's API. */
  mode: "signup" | "signin";
  /** Where to send the user after a successful auth. Defaults to /app.
   *  Ignored when `onSuccess` is provided (re-auth context). */
  redirectTo?: string;
  /** When provided, called with the fresh session instead of navigating.
   *  Used by the SessionExpiredDialog so re-auth resumes the current page. */
  onSuccess?: (session: AuthSession) => void;
  /** When provided, replaces the default toast on error so callers can render
   *  the message inside their own banner. */
  onError?: (message: string) => void;
}

export function AppleSignInButton({ mode: _mode, redirectTo = "/app", onSuccess, onError }: Props) {
  const { t, locale } = useT();
  const { setSession } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const initialised = useRef(false);

  useEffect(() => {
    if (!CLIENT_ID) {
      if (import.meta.env.DEV) {
        console.warn(
          "[AppleSignInButton] VITE_APPLE_CLIENT_ID is empty. Restart `bun run dev:frontend` after editing frontend/.env.",
        );
      }
      setHidden(true);
      return;
    }
    let cancelled = false;
    loadAppleJs(locale)
      .then(() => {
        if (cancelled) return;
        const apple = getApple();
        if (!apple) {
          setHidden(true);
          return;
        }
        // redirectURI must be https and exactly match a Return URL registered
        // on the Services ID. Default to the current origin for the popup flow.
        apple.init({
          clientId: CLIENT_ID,
          scope: "name email",
          redirectURI: REDIRECT_URI || window.location.origin,
          usePopup: true,
        });
        initialised.current = true;
      })
      .catch(() => {
        if (!cancelled) setHidden(true);
      });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  async function onClick() {
    const apple = getApple();
    if (!apple || !initialised.current || busy) return;
    setBusy(true);
    try {
      const resp = await apple.signIn();
      // Apple hands the name only on first authorization — stitch it into a
      // display name for brand-new accounts (backend uses it for display only).
      const first = resp.user?.name?.firstName?.trim() ?? "";
      const last = resp.user?.name?.lastName?.trim() ?? "";
      const fullName = `${first} ${last}`.trim();
      const session = await authApi.apple({
        credential: resp.authorization.id_token,
        ...(fullName ? { full_name: fullName } : {}),
        privacy_version: PRIVACY_VERSION,
        terms_version: TERMS_VERSION,
        locale,
      });
      if (onSuccess) {
        onSuccess(session);
      } else {
        // A real Apple sign-in/up ends any demo session live on this device.
        clearDemoSessionFlag();
        setSession(session.token, session.user);
        navigate(redirectTo, { replace: true });
      }
    } catch (err) {
      // The user closing or cancelling the Apple popup is not an error worth
      // surfacing — Apple raises a string `error` for those.
      const code = (err as { error?: string } | null)?.error;
      if (code === "popup_closed_by_user" || code === "user_cancelled_authorize") {
        return;
      }
      const msg =
        err instanceof ApiError
          ? err.status === 429
            ? t("auth.rate_limited")
            : err.status === 503
              ? t("auth.apple_unavailable")
              : t("auth.apple_failed")
          : t("auth.apple_failed");
      if (onError) onError(msg);
      else toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  if (hidden) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      // Apple HIG: black pill, white Apple mark + label. bg-black is true black
      // per the brand guidelines (the warm umber tokens would read off-brand).
      className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full bg-black px-4 text-[15px] font-medium text-white transition hover:opacity-90 disabled:opacity-60"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        width="16"
        height="16"
        fill="currentColor"
        className="-mt-0.5"
      >
        <path d="M11.182.008C11.148-.03 9.923.023 8.857 1.18c-1.066 1.156-.902 2.482-.878 2.516s1.52.087 2.475-1.258.762-2.391.728-2.43m3.314 11.733c-.048-.096-2.325-1.234-2.113-3.422s1.675-2.789 1.698-2.854-.597-.79-1.254-1.157a3.7 3.7 0 0 0-1.563-.434c-.108-.003-.483-.095-1.254.116-.508.139-1.653.589-1.968.607-.316.018-1.256-.522-2.267-.665-.647-.125-1.333.131-1.824.328-.49.196-1.422.754-2.074 2.237-.652 1.482-.311 3.83-.067 4.56s.625 1.924 1.273 2.796c.576.984 1.34 1.667 1.659 1.899s1.219.386 1.843.067c.502-.308 1.408-.485 1.766-.472.357.013 1.061.154 1.782.539.571.197 1.111.115 1.652-.105.541-.221 1.324-1.059 2.238-2.758.347-.79.505-1.217.473-1.282" />
      </svg>
      <span>{t("auth.continue_with_apple")}</span>
    </button>
  );
}
