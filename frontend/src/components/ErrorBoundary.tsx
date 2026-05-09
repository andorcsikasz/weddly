import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./ui/Button";
import { useT } from "../lib/i18n";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

declare global {
  interface Window {
    // Set by the optional Sentry browser SDK once VITE_SENTRY_DSN is wired up.
    // We only call it defensively so the boundary works whether Sentry is
    // initialized or not.
    Sentry?: { captureException: (e: unknown, ctx?: unknown) => void };
  }
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[error-boundary]", error, info.componentStack);
    window.Sentry?.captureException(error, {
      contexts: { react: { componentStack: info.componentStack } },
    });
  }

  render() {
    if (this.state.error) {
      return <ErrorFallback error={this.state.error} />;
    }
    return this.props.children;
  }
}

function ErrorFallback({ error }: { error: Error }) {
  const { t } = useT();
  // A soft reset re-renders the same crashing tree and would crash again, so
  // both actions force a full reload — to the same URL or to home.
  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold text-ink-900">{t("error_boundary.title")}</h1>
        <p className="mt-3 text-ink-600">{t("error_boundary.body")}</p>
        <div className="mt-6 flex flex-col items-center gap-3">
          <Button onClick={() => window.location.reload()} variant="primary">
            {t("error_boundary.try_again")}
          </Button>
          <a href="/" className="text-ink-500 text-sm underline">
            {t("error_boundary.go_home")}
          </a>
        </div>
        {import.meta.env.DEV && (
          <pre className="mt-6 max-h-48 overflow-auto rounded bg-ink-50 p-3 text-left text-xs text-ink-700">
            {error.message}
            {error.stack ? `\n${error.stack}` : ""}
          </pre>
        )}
      </div>
    </div>
  );
}
