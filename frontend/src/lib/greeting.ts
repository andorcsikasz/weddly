// Which greeting the vendor dashboard opens with.
//
// "Welcome, {name}" is the same sentence at 6am on a Tuesday and on Christmas
// morning, which is another way of saying it isn't addressed to anybody. This
// picks a line for the hour the vendor is actually reading it, and steps aside
// for a handful of days in the year where a person would say something else.
//
// Rules that keep it from getting embarrassing:
//
//   1. HOLIDAYS ARE NOT LOCALE-GATED. `locale` is the language of the
//      interface, not the country of the business: a Hungarian venue that reads
//      Weddly in English is not Spanish. So the only days here are the ones
//      every market we serve keeps (Christmas, New Year, Easter) plus
//      Valentine's, which is not a public holiday anywhere but is the single
//      most on-brand day of the year for a wedding supplier. National days stay
//      out until vendor country is a field we can trust.
//   2. NOTHING IS INFERRED ABOUT THE PERSON. No "working late again?", no
//      streaks, no "you haven't logged in for a while". A greeting that
//      comments on behaviour reads as surveillance the second it is wrong.
//   3. It is computed from the DEVICE clock on purpose. The vendor's own
//      evening is the one that matters, and the server has no idea what it is.

/** The i18n key suffix under `vendor.dashboard.greeting.*`. */
export type GreetingKey =
  | "early"
  | "morning"
  | "midday"
  | "afternoon"
  | "early_evening"
  | "evening"
  | "night"
  | "christmas"
  | "new_year"
  | "valentines"
  | "easter";

/** Anonymous Gregorian computus. Returns Easter Sunday for a given year in
 *  local time, which is what dates the whole Good-Friday-to-Monday window. */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function daysBetween(a: Date, b: Date): number {
  const dayA = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const dayB = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((dayA - dayB) / 86_400_000);
}

/** The holiday covering this date, if any. Windows, not single days: a supplier
 *  works through the 24th and the 26th as much as the 25th, and greeting them
 *  only on the one day most of them are off is greeting them never. */
function holidayFor(date: Date): GreetingKey | null {
  const month = date.getMonth() + 1;
  const day = date.getDate();

  // Dec 24-26. The 24th is the evening that matters in HU/ES, the 25th in the
  // English-speaking markets, so the window carries all three.
  if (month === 12 && day >= 24 && day <= 26) return "christmas";
  // Dec 31 - Jan 2. Wished forward on the eve and still true on the 2nd, which
  // is the first working day most years.
  if ((month === 12 && day === 31) || (month === 1 && day <= 2)) return "new_year";
  if (month === 2 && day === 14) return "valentines";

  // Good Friday through Easter Monday.
  const offset = daysBetween(date, easterSunday(date.getFullYear()));
  if (offset >= -2 && offset <= 1) return "easter";

  return null;
}

/** Time of day, from the reader's own clock.
 *
 *  Seven bands rather than the obvious four, because the obvious four give a
 *  vendor the same three sentences forever. The extra ones sit at the edges
 *  where "good morning" starts to sound wrong: 6am is not a morning greeting,
 *  it is a remark about being up; noon is neither morning nor afternoon; 5pm is
 *  too early for good evening and too late for good afternoon, so it just says
 *  hello.
 *
 *  Bands are half-open [start, end) on the hour, and 22:00-04:59 wraps
 *  midnight. */
function timeOfDay(date: Date): GreetingKey {
  const hour = date.getHours();
  if (hour >= 22 || hour < 5) return "night";
  if (hour < 8) return "early";
  if (hour < 11) return "morning";
  if (hour < 14) return "midday";
  if (hour < 17) return "afternoon";
  if (hour < 19) return "early_evening";
  return "evening";
}

/** The greeting for a moment: a holiday if the date is one, otherwise the hour.
 *
 *  A holiday deliberately OUTRANKS the hour rather than combining with it.
 *  "Good morning and merry Christmas" is two greetings, and a person picks
 *  one. */
export function greetingKeyFor(date: Date = new Date()): GreetingKey {
  return holidayFor(date) ?? timeOfDay(date);
}
