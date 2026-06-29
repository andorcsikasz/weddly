// Shared inline "add a client" card used by both the dashboard and the Clients
// roster page. Requests access by email (consent-gated server-side) and shows
// the consent hint so the planner knows the couple must approve.

import { X } from "lucide-react";
import { useState } from "react";
import { plannerApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";

export function AddClientCard({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useT();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("loading");
    setError("");
    try {
      await plannerApi.addClient(email.trim());
      setStatus("ok");
      setEmail("");
      onSuccess();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : t("planner_home.add_client_error"));
    }
  }

  return (
    <div className="card mt-4 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-grotesk text-sm font-semibold text-umber-800 dark:text-paper-200">
          {t("planner_home.add_client_heading")}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1 text-umber-500 hover:bg-paper-100 hover:text-umber-800 dark:text-umber-400 dark:hover:bg-umber-800 dark:hover:text-paper-100"
          aria-label={t("planner_home.back_label")}
        >
          <X size={16} />
        </button>
      </div>
      <form onSubmit={(e) => void handleSubmit(e)} className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (status !== "idle") setStatus("idle");
          }}
          placeholder={t("planner_home.add_client_placeholder")}
          className="input flex-1 text-sm"
          disabled={status === "loading"}
          autoFocus
        />
        <button
          type="submit"
          disabled={status === "loading" || !email.trim()}
          className="btn-primary btn-sm shrink-0"
        >
          {t("planner_home.add_client_button")}
        </button>
      </form>
      <p className="mt-2 text-xs text-umber-500 dark:text-umber-400">
        {t("planner_home.add_client_hint")}
      </p>
      {status === "ok" && (
        <p className="mt-2 text-xs text-sage-600">{t("planner_home.add_client_success")}</p>
      )}
      {status === "error" && <p className="mt-2 text-xs text-red-500">{error}</p>}
    </div>
  );
}
