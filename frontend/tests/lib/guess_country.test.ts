// The country list opens on the countries this browser points at. A guess
// only orders the list, so what matters is the order of trust (time zone
// before language region before UI locale) and that nothing unknown leaks in.
import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { guessCountries } from "@/lib/guess_country";

function withBrowser(timeZone: string, languages: string[]) {
  const tz = spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
    timeZone,
  } as Intl.ResolvedDateTimeFormatOptions);
  Object.defineProperty(navigator, "languages", { value: languages, configurable: true });
  return () => {
    tz.mockRestore();
    // biome-ignore lint/performance/noDelete: drops the own override so the prototype getter shows again
    delete (navigator as { languages?: unknown }).languages;
  };
}

let restore: () => void = () => {};
afterEach(() => restore());

describe("guessCountries", () => {
  it("puts the time zone's country before the language region", () => {
    restore = withBrowser("Europe/Budapest", ["en-US", "hu"]);
    expect(guessCountries("en")).toEqual(["HU", "US"]);
  });

  it("falls back to the language region, then the UI locale", () => {
    restore = withBrowser("Etc/Unknown", ["de-AT"]);
    expect(guessCountries("hr")).toEqual(["AT", "HR"]);
  });

  it("returns nothing it cannot place, never a made-up code", () => {
    restore = withBrowser("Etc/Unknown", ["en"]);
    expect(guessCountries("en")).toEqual([]);
  });
});
