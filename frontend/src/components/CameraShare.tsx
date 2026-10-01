// /camera "Share it with a…" section: the two ways a film actually reaches
// guests in the product today, the film's QR code (saved as an image from
// /app/media) and its guest link. Tabs on the left, an illustration on the
// right that swaps with the tab.
//
// Only real channels belong here. The table cards drawn for the QR tab are an
// illustration of where couples put the code, not a template the app ships:
// no printable renderer emits a QR (see PrintCardPreview's own note), so the
// copy says "save it as an image", never "pick a template".
import { Link2, MessageCircle, Send } from "lucide-react";
import { useState } from "react";
import { useT } from "../lib/i18n";

type Channel = "qr" | "link";

export function CameraShare({ coupleName }: { coupleName: string }) {
  const { t } = useT();
  const [channel, setChannel] = useState<Channel>("qr");
  const tabs: { key: Channel; label: string }[] = [
    { key: "qr", label: t("camera.share_tab_qr") },
    { key: "link", label: t("camera.share_tab_link") },
  ];

  return (
    <section className="grid items-center gap-12 md:grid-cols-2">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-paper-50 sm:text-3xl">
          {t("camera.share_title")}
        </h2>
        <div role="tablist" aria-orientation="vertical" className="mt-8 space-y-2">
          {tabs.map((tab) => {
            const active = tab.key === channel;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setChannel(tab.key)}
                className="flex w-full items-center gap-4 py-1.5 text-left"
              >
                <span
                  className={`h-8 w-1 rounded-full transition-colors duration-300 ${
                    active ? "bg-paper-50" : "bg-paper-50/15"
                  }`}
                />
                <span
                  className={`text-lg font-semibold transition-colors duration-300 ${
                    active ? "text-paper-50" : "text-paper-500 hover:text-paper-300"
                  }`}
                >
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
        <p
          key={channel}
          className="mt-8 max-w-md animate-card-lift text-[15px] leading-relaxed text-paper-300 motion-reduce:animate-none"
        >
          {channel === "qr" ? t("camera.share_qr_body") : t("camera.share_link_body")}
        </p>
      </div>

      <div className="relative mx-auto h-[22rem] w-full max-w-md" aria-hidden="true">
        {channel === "qr" ? <QrCards coupleName={coupleName} /> : <LinkCard />}
      </div>
    </section>
  );
}

/** Three table cards fanned out, the middle one on top. */
function QrCards({ coupleName }: { coupleName: string }) {
  return (
    <div key="qr" className="absolute inset-0 animate-card-lift motion-reduce:animate-none">
      <div className="absolute left-[4%] top-[12%] h-[17rem] w-[11.5rem] -rotate-[9deg] rounded-xl bg-eucalyptus-700 p-4 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
        <p className="font-grotesk text-lg font-bold uppercase leading-tight text-paper-50">
          {coupleName}
        </p>
        <div className="mt-2 h-0.5 w-10 bg-paper-50/70" />
        <div className="absolute bottom-6 left-1/2 w-16 -translate-x-1/2 rounded bg-paper-50 p-1">
          <img src="/camera-try-qr.svg" alt="" className="block w-full" />
        </div>
      </div>
      <div className="absolute right-[4%] top-[14%] h-[17rem] w-[11.5rem] rotate-[9deg] rounded-xl bg-blush-700 p-4 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
        <div className="absolute right-4 top-14 w-16 rounded bg-paper-50 p-1">
          <img src="/camera-try-qr.svg" alt="" className="block w-full" />
        </div>
        <p className="absolute bottom-5 left-4 font-serif text-sm italic text-paper-100">
          '26 09 12
        </p>
      </div>
      <div className="absolute left-1/2 top-0 z-10 flex h-[20rem] w-[13rem] -translate-x-1/2 flex-col rounded-xl border border-paper-50/10 bg-ink-900 p-5 shadow-[0_28px_70px_rgba(0,0,0,0.6)]">
        <div className="ml-auto w-20 rounded bg-paper-50 p-1.5">
          <img src="/camera-try-qr.svg" alt="" className="block w-full" />
        </div>
        <p className="mt-5 font-serif text-2xl uppercase leading-tight tracking-wide text-paper-50">
          {coupleName.split(" & ").map((name, i) => (
            <span key={name} className="block">
              {i > 0 && <span className="block">&amp;</span>}
              {name}
            </span>
          ))}
        </p>
        <p className="mt-4 font-serif text-[10px] uppercase tracking-[0.25em] text-paper-300">
          2026 · 09 · 12
        </p>
        <div className="mt-auto space-y-1.5">
          <div className="h-1 w-4/5 rounded-full bg-paper-50/20" />
          <div className="h-1 w-3/5 rounded-full bg-paper-50/20" />
        </div>
      </div>
    </div>
  );
}

/** The same film reaching guests as a link in a chat. */
function LinkCard() {
  return (
    <div
      key="link"
      className="absolute inset-0 flex items-center justify-center animate-card-lift motion-reduce:animate-none"
    >
      <div className="w-[17rem] rounded-[2rem] border border-paper-50/15 bg-umber-950 p-[5px] shadow-[0_28px_70px_rgba(0,0,0,0.6)]">
        <div className="space-y-3 rounded-[1.65rem] bg-umber-900 px-4 pb-5 pt-6">
          <div className="mx-auto h-1.5 w-10 rounded-full bg-black/60" />
          <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-paper-50 px-3.5 py-2.5 text-umber-950">
            <span className="flex items-center gap-1.5 text-xs font-semibold">
              <Link2 size={13} />
              tryweddly.com/photos/…
            </span>
          </div>
          <div className="w-fit max-w-[85%] rounded-2xl rounded-bl-md bg-paper-50/10 px-3.5 py-2.5">
            <span className="block h-1.5 w-28 rounded-full bg-paper-50/35" />
            <span className="mt-1.5 block h-1.5 w-20 rounded-full bg-paper-50/35" />
          </div>
          <div className="ml-auto w-fit rounded-2xl rounded-br-md bg-paper-50 px-3.5 py-2.5">
            <span className="block h-1.5 w-16 rounded-full bg-umber-950/40" />
          </div>
          <div className="flex items-center gap-2 pt-2">
            <span className="h-9 flex-1 rounded-full bg-paper-50/[0.07]" />
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-paper-50/10 text-paper-200">
              <MessageCircle size={15} />
            </span>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-paper-50 text-umber-950">
              <Send size={15} />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
