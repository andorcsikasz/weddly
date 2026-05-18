// "Continue with Google" button. Loads Google Identity Services on demand,
// renders Google's official button into the placeholder div, and hands the
// returned credential JWT to the backend for verification.
//
// VITE_GOOGLE_CLIENT_ID is baked at build time; when it's missing (local dev
// without a Cloud Console project) the component renders nothing so the
// password form stays usable.

import { PRIVACY_VERSION } from "@shared/legal";
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
}

const CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "") as string;

export function GoogleSignInButton({ mode, redirectTo = "/app" }: Props) {
  const { t, locale } = useT();
  const { setSession } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!CLIENT_ID) {
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
            try {
              const session = await authApi.google({
                credential: resp.credential,
                privacy_version: PRIVACY_VERSION,
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
          auto_select: false,
          cancel_on_tap_outside: true,
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
          shape: "rectangular",
          logo_alignment: "left",
          width,
          locale: locale === "hu" ? "hu_HU" : "en_US",
        });
      })
      .catch(() => {
        if (!cancelled) setHidden(true);
      });

    return () => {
      cancelled = true;
    };
  }, [mode, redirectTo, locale, navigate, setSession, t, toast]);

  if (hidden) return null;
  // Min-height matches Google's "large" button so the layout doesn't jump
  // while the script loads.
  return <div ref={hostRef} className="flex min-h-[44px] w-full justify-center" />;
}
