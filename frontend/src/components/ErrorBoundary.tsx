import { captureException } from "@sentry/react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./ui/Button";
import { useT } from "../lib/i18n";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  reloading: boolean;
}

// Most render crashes are transient (stale chunk after deploy, race on first
// render, flaky network). We retry up to MAX_AUTO_RELOADS times with a short
// backoff before giving up and letting the user decide. The counter persists
// in sessionStorage so a fresh page load can resume the retry chain; if the
// last crash was more than RESET_AFTER_MS ago we treat it as a new incident.
const COUNT_KEY = "weddly.errorBoundary.autoReloadCount";
const LAST_AT_KEY = "weddly.errorBoundary.lastCrashAt";
const MAX_AUTO_RELOADS = 3;
const RESET_AFTER_MS = 60_000;

function readAttempt(): number {
  try {
    const last = Number.parseInt(sessionStorage.getItem(LAST_AT_KEY) ?? "0", 10) || 0;
    if (last && Date.now() - last > RESET_AFTER_MS) return 0;
    return Number.parseInt(sessionStorage.getItem(COUNT_KEY) ?? "0", 10) || 0;
  } catch {
    return 0;
  }
}

function writeAttempt(n: number): void {
  try {
    sessionStorage.setItem(COUNT_KEY, String(n));
    sessionStorage.setItem(LAST_AT_KEY, String(Date.now()));
  } catch {
    // sessionStorage can throw in privacy modes; fall through.
  }
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, reloading: false };

  static getDerivedStateFromError(error: Error): State {
    return { error, reloading: false };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const prior = readAttempt();
    const attempt = prior + 1;
    writeAttempt(attempt);

    captureException(error, {
      contexts: { react: { componentStack: info.componentStack } },
      tags: { autoReloadAttempt: String(attempt) },
    });

    if (attempt > MAX_AUTO_RELOADS) {
      console.error("[error-boundary] giving up after retries", error, info.componentStack);
      return;
    }

    console.warn(`[error-boundary] auto-reload ${attempt}/${MAX_AUTO_RELOADS}`, error.message);

    // First attempt: instant reload so transient crashes (stale chunks, etc.)
    // never surface a fallback at all. Subsequent attempts wait briefly so the
    // user sees the fallback explain what's happening rather than the page
    // appearing to flash repeatedly.
    if (prior === 0) {
      window.location.reload();
      return;
    }
    this.setState({ reloading: true });
    window.setTimeout(() => window.location.reload(), 1500 * prior);
  }

  render() {
    if (this.state.error) {
      return <ErrorFallback error={this.state.error} reloading={this.state.reloading} />;
    }
    return this.props.children;
  }
}

function ErrorFallback({ error, reloading }: { error: Error; reloading: boolean }) {
  const { t } = useT();
  // A soft reset re-renders the same crashing tree and would crash again, so
  // both actions force a full reload — to the same URL or to home.
  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold text-ink-900 dark:text-paper-50">
          {t("error_boundary.title")}
        </h1>
        <p className="mt-3 text-ink-600 dark:text-umber-200">{t("error_boundary.body")}</p>
        <div className="mt-6 flex flex-col items-center gap-3">
          <Button
            onClick={() => window.location.reload()}
            variant="primary"
            loading={reloading}
            loadingLabel={t("error_boundary.try_again_pending")}
          >
            {t("error_boundary.try_again")}
          </Button>
          <a href="/" className="text-ink-500 text-sm underline dark:text-umber-300">
            {t("error_boundary.go_home")}
          </a>
        </div>
        {import.meta.env.DEV && (
          <pre className="mt-6 max-h-48 overflow-auto rounded bg-ink-50 p-3 text-left text-xs text-ink-700 dark:bg-umber-700/60 dark:text-paper-100">
            {error.message}
            {error.stack ? `\n${error.stack}` : ""}
          </pre>
        )}
      </div>
    </div>
  );
}
