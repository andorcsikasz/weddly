// Frontend side of the real-name rule. The RULE itself lives in
// `@shared/real_names` and is the same code the server runs; this file is only
// the translation from a verdict to a line of copy, plus the reader for the
// server's refusal.

import type { PlaceholderNameReason } from "@shared/real_names";
import { ApiError } from "./api";

/** The i18n key explaining one refusal. Every reason gets its own line rather
 *  than a single "invalid name": "that is a role, not a name" and "that is one
 *  letter" are different mistakes and deserve different fixes. */
export function realNameErrorKey(reason: PlaceholderNameReason): string {
  switch (reason) {
    case "too_short":
      return "real_names.error_too_short";
    case "role_word":
      return "real_names.error_role_word";
    case "repeated":
    case "keyboard":
    case "no_vowel":
    case "no_letters":
      return "real_names.error_not_a_name";
    default:
      return "real_names.error_placeholder";
  }
}

/** The field a `400 placeholder_name` refusal names, or null for any other
 *  error. Lets a form re-open the step that holds the offending input instead
 *  of showing a generic failure at the end of a wizard. */
export function placeholderNameField(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status !== 400) return null;
  const detail = err.detail && typeof err.detail === "object" ? err.detail : {};
  if ((detail as { code?: string }).code !== "placeholder_name") return null;
  return (detail as { field?: string }).field ?? "";
}

/** True when the server refused a write because the workspace's 3-day name
 *  correction window has passed (`409 name_review_required`). */
export function isNameReviewBlock(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 409) return false;
  const detail = err.detail && typeof err.detail === "object" ? err.detail : {};
  return (detail as { code?: string }).code === "name_review_required";
}
