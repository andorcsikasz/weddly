// HUF formatter. Currency never translates — only grouping/decimal mark.

const hufFmt = new Intl.NumberFormat("hu-HU", {
  style: "currency",
  currency: "HUF",
  maximumFractionDigits: 0,
});

const hufFmtEn = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "HUF",
  maximumFractionDigits: 0,
});

export function formatHuf(amount: number, locale: "hu" | "en" = "hu"): string {
  return (locale === "en" ? hufFmtEn : hufFmt).format(Math.round(amount));
}

export function formatDate(ymd: string | null, locale: "hu" | "en" = "hu"): string {
  if (!ymd) return "";
  const d = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString(locale === "hu" ? "hu-HU" : "en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
