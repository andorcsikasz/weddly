// A money entry field that shows the figure the way a person writes it:
// "200 000 000", not "200000000".
//
// `<input type="number">` cannot do this: the browser renders the raw value
// and treats a separator as invalid input. That number input is also what
// these fields carried `step={1000}` for, a spinner increment the browser
// enforces as VALIDATION, which refused every euro amount a couple typed and
// every forint amount that wasn't a round thousand. So this is a text field
// in numeric mode that keeps RAW DIGITS in the caller's state and formats on
// every render, the shape the onboarding budget step has always used.
//
// What the caller keeps: `value` is digits only, so `Number(value)` still
// works everywhere it did before, and validation stays where it already was.
// `inputMode="numeric"` still brings up the phone keypad.

import type { InputHTMLAttributes } from "react";
import { digitsOnly, formatGroupedDigits } from "../lib/format";
import type { Locale } from "../lib/i18n";

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type" | "inputMode"
> & {
  /** Raw digits, no separators. */
  value: string;
  /** Receives raw digits, already stripped of whatever the user pasted. */
  onChange: (digits: string) => void;
  locale: Locale;
  /** An all-digits placeholder is grouped like the value, so the example
   *  amount reads the same way the typed one will. Anything else (a dash, a
   *  translated hint) passes through untouched. */
  placeholder?: string;
};

export function MoneyInput({ value, onChange, locale, placeholder, ...rest }: Props) {
  const shownPlaceholder =
    placeholder && /^\d+$/.test(placeholder)
      ? formatGroupedDigits(placeholder, locale)
      : placeholder;
  return (
    <input
      {...rest}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={formatGroupedDigits(value, locale)}
      placeholder={shownPlaceholder}
      onChange={(e) => onChange(digitsOnly(e.target.value))}
    />
  );
}
