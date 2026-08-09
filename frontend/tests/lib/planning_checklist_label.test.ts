import { describe, expect, it } from "bun:test";
import de from "@/locales/de";
import en from "@/locales/en";
import es from "@/locales/es";
import hr from "@/locales/hr";
import hu from "@/locales/hu";

describe("planning checklist tab label", () => {
  it("uses Checklist in every supported locale", () => {
    for (const locale of [en, hu, de, es, hr]) {
      expect(locale.planning.checklist.title).toBe("Checklist");
    }
  });
});
