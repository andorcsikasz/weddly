import { type FormEvent, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PublicShell } from "../components/PublicShell";
import { ApiError, apiFetch } from "../lib/api";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

interface PublicNotice {
  reference: string;
  status: "submitted" | "reviewing" | "actioned" | "rejected";
  content_url: string;
  decision_reason: string | null;
  decided_at: number | null;
  appealed_at: number | null;
  appeal_decision: string | null;
  appeal_decided_at: number | null;
  created_at: number;
}

const copy = {
  en: {
    title: "Report illegal content",
    intro:
      "Use this notice-and-action form for content hosted by Weddly. Give the exact URL and explain why it is unlawful. We acknowledge the notice by email and provide a reasoned outcome.",
    submitTab: "Submit a notice",
    statusTab: "Check or appeal a case",
    affectedTab: "Appeal a decision about your content",
    name: "Your full name",
    email: "Your email",
    url: "Exact Weddly content URL",
    illegality: "Legal right or rule allegedly infringed",
    explanation: "Why the content is illegal",
    declaration:
      "I believe in good faith that the information and allegations in this notice are accurate and complete.",
    send: "Submit notice",
    sent: "Notice received. Save this reference:",
    reference: "Case reference",
    check: "Check case",
    appeal: "Why should the decision be reconsidered?",
    appealSend: "Submit one appeal",
    appealed: "Appeal submitted.",
    affectedIntro:
      "Use the reference in the moderation email and the notified email address. This path is for the person or business whose content was restricted.",
  },
  hu: {
    title: "Jogellenes tartalom bejelentése",
    intro:
      "Ezen az értesítési és intézkedési űrlapon a Weddly által tárolt tartalom jelenthető. Add meg a pontos URL-t és indokold a jogellenességet. E-mailben visszaigazoljuk, majd indokolt döntést küldünk.",
    submitTab: "Bejelentés küldése",
    statusTab: "Ügy ellenőrzése vagy fellebbezés",
    affectedTab: "A tartalmadról szóló döntés megfellebbezése",
    name: "Teljes neved",
    email: "E-mail-címed",
    url: "A Weddly-tartalom pontos URL-je",
    illegality: "A feltételezetten sértett jog vagy szabály",
    explanation: "Miért jogellenes a tartalom?",
    declaration:
      "Jóhiszeműen úgy vélem, hogy a bejelentésben szereplő információ és állítás pontos és teljes.",
    send: "Bejelentés elküldése",
    sent: "A bejelentést fogadtuk. Mentsd el a hivatkozást:",
    reference: "Ügyhivatkozás",
    check: "Ügy ellenőrzése",
    appeal: "Miért kell a döntést felülvizsgálni?",
    appealSend: "Egyszeri fellebbezés küldése",
    appealed: "A fellebbezést elküldtük.",
    affectedIntro:
      "Használd a moderációs e-mailben kapott hivatkozást és az értesített e-mail-címet. Ez az út annak szól, akinek a tartalmát korlátoztuk.",
  },
} as const;

export default function ContentNoticePage() {
  const { locale } = useT();
  const c = locale === "hu" ? copy.hu : copy.en;
  const [searchParams] = useSearchParams();
  useDocumentMeta(c.title, c.intro);
  const [mode, setMode] = useState<"submit" | "status" | "affected">(() =>
    searchParams.get("affected") === "1" ? "affected" : "submit",
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [url, setUrl] = useState("");
  const [illegality, setIllegality] = useState("");
  const [explanation, setExplanation] = useState("");
  const [goodFaith, setGoodFaith] = useState(false);
  const [reference, setReference] = useState("");
  const [statusEmail, setStatusEmail] = useState("");
  const [notice, setNotice] = useState<PublicNotice | null>(null);
  const [appeal, setAppeal] = useState("");
  const [affectedAppeal, setAffectedAppeal] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const errorMessage = (error: unknown) =>
    error instanceof ApiError ? error.message : "Request failed. Please try again.";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const result = await apiFetch<{ reference: string }>("POST", "/api/legal/content-notices", {
        reporter_name: name,
        reporter_email: email,
        content_url: url,
        illegality,
        explanation,
        good_faith: goodFaith,
      });
      setReference(result.reference);
      setStatusEmail(email);
      setMessage(`${c.sent} ${result.reference}`);
      setMode("status");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function check(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const result = await apiFetch<{ notice: PublicNotice }>(
        "GET",
        `/api/legal/content-notices/${encodeURIComponent(reference.trim())}?email=${encodeURIComponent(statusEmail.trim())}`,
      );
      setNotice(result.notice);
    } catch (error) {
      setNotice(null);
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function submitAppeal(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await apiFetch("POST", `/api/legal/content-notices/${encodeURIComponent(reference)}/appeal`, {
        reporter_email: statusEmail,
        reason: appeal,
      });
      setMessage(c.appealed);
      setNotice((current) => (current ? { ...current, appealed_at: Date.now() } : current));
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function checkAffected(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const result = await apiFetch<{ notice: PublicNotice }>(
        "GET",
        `/api/legal/content-notices/${encodeURIComponent(reference.trim())}/affected?email=${encodeURIComponent(statusEmail.trim())}`,
      );
      setNotice(result.notice);
    } catch (error) {
      setNotice(null);
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function submitAffectedAppeal(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await apiFetch(
        "POST",
        `/api/legal/content-notices/${encodeURIComponent(reference)}/affected-appeal`,
        { email: statusEmail, reason: affectedAppeal },
      );
      setMessage(c.appealed);
      setNotice((current) => (current ? { ...current, appealed_at: Date.now() } : current));
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const field = "input w-full";
  return (
    <PublicShell>
      <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-20">
        <h1 className="font-serif text-4xl text-umber-950 dark:text-paper-50">{c.title}</h1>
        <p className="mt-4 text-umber-700 dark:text-umber-200">{c.intro}</p>
        <div className="mt-8 flex gap-2" role="tablist">
          {(["submit", "status", "affected"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className={`rounded-lg px-4 py-2 text-sm ${mode === tab ? "bg-umber-900 text-white" : "border border-umber-300"}`}
              onClick={() => setMode(tab)}
            >
              {tab === "submit" ? c.submitTab : tab === "status" ? c.statusTab : c.affectedTab}
            </button>
          ))}
        </div>

        {mode === "submit" ? (
          <form className="mt-8 space-y-5" onSubmit={submit}>
            <label className="block">
              <span className="field-label">{c.name}</span>
              <input
                className={field}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={2}
                maxLength={200}
              />
            </label>
            <label className="block">
              <span className="field-label">{c.email}</span>
              <input
                className={field}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                maxLength={200}
              />
            </label>
            <label className="block">
              <span className="field-label">{c.url}</span>
              <input
                className={field}
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
                maxLength={800}
              />
            </label>
            <label className="block">
              <span className="field-label">{c.illegality}</span>
              <textarea
                className={field}
                value={illegality}
                onChange={(e) => setIllegality(e.target.value)}
                required
                minLength={10}
                maxLength={2000}
                rows={3}
              />
            </label>
            <label className="block">
              <span className="field-label">{c.explanation}</span>
              <textarea
                className={field}
                value={explanation}
                onChange={(e) => setExplanation(e.target.value)}
                required
                minLength={20}
                maxLength={4000}
                rows={6}
              />
            </label>
            <label className="flex items-start gap-3">
              <input
                className="mt-1"
                type="checkbox"
                checked={goodFaith}
                onChange={(e) => setGoodFaith(e.target.checked)}
                required
              />
              <span>{c.declaration}</span>
            </label>
            <button className="btn-primary" type="submit" disabled={busy}>
              {c.send}
            </button>
          </form>
        ) : mode === "status" ? (
          <div className="mt-8 space-y-6">
            <form className="space-y-5" onSubmit={check}>
              <label className="block">
                <span className="field-label">{c.reference}</span>
                <input
                  className={field}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  required
                  minLength={32}
                  maxLength={32}
                />
              </label>
              <label className="block">
                <span className="field-label">{c.email}</span>
                <input
                  className={field}
                  type="email"
                  value={statusEmail}
                  onChange={(e) => setStatusEmail(e.target.value)}
                  required
                />
              </label>
              <button className="btn-primary" type="submit" disabled={busy}>
                {c.check}
              </button>
            </form>
            {notice && (
              <div className="rounded-xl border border-umber-200 p-5">
                <p className="font-semibold">{notice.status}</p>
                <p className="mt-2 break-all text-sm">{notice.content_url}</p>
                {notice.decision_reason && <p className="mt-3">{notice.decision_reason}</p>}
              </div>
            )}
            {notice?.decided_at && !notice.appealed_at && (
              <form className="space-y-4" onSubmit={submitAppeal}>
                <label className="block">
                  <span className="field-label">{c.appeal}</span>
                  <textarea
                    className={field}
                    value={appeal}
                    onChange={(e) => setAppeal(e.target.value)}
                    required
                    minLength={20}
                    maxLength={4000}
                    rows={5}
                  />
                </label>
                <button className="btn-primary" type="submit" disabled={busy}>
                  {c.appealSend}
                </button>
              </form>
            )}
          </div>
        ) : (
          <div className="mt-8 space-y-6">
            <p>{c.affectedIntro}</p>
            <form className="space-y-5" onSubmit={checkAffected}>
              <label className="block">
                <span className="field-label">{c.reference}</span>
                <input
                  className={field}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  required
                  minLength={32}
                  maxLength={32}
                />
              </label>
              <label className="block">
                <span className="field-label">{c.email}</span>
                <input
                  className={field}
                  type="email"
                  value={statusEmail}
                  onChange={(e) => setStatusEmail(e.target.value)}
                  required
                />
              </label>
              <button className="btn-primary" type="submit" disabled={busy}>
                {c.check}
              </button>
            </form>
            {notice && (
              <div className="rounded-xl border border-umber-200 p-5">
                <p className="font-semibold">{notice.status}</p>
                <p className="mt-2 break-all text-sm">{notice.content_url}</p>
                {notice.decision_reason && <p className="mt-3">{notice.decision_reason}</p>}
              </div>
            )}
            {notice?.decided_at && !notice.appealed_at && (
              <form className="space-y-4" onSubmit={submitAffectedAppeal}>
                <label className="block">
                  <span className="field-label">{c.appeal}</span>
                  <textarea
                    className={field}
                    value={affectedAppeal}
                    onChange={(e) => setAffectedAppeal(e.target.value)}
                    required
                    minLength={20}
                    maxLength={4000}
                    rows={5}
                  />
                </label>
                <button className="btn-primary" type="submit" disabled={busy}>
                  {c.appealSend}
                </button>
              </form>
            )}
          </div>
        )}
        {message && (
          <p className="mt-6 rounded-lg bg-paper-200 p-4" role="status">
            {message}
          </p>
        )}
      </article>
    </PublicShell>
  );
}
