import { Plus } from "lucide-react";
import { useState } from "react";
import {
  CUSTOM_REVIEW_TAG_MAX_CHARS,
  MAX_REVIEW_TAGS,
  normaliseCustomReviewTag,
  reviewTagsForCategory,
  type SupplierCategory,
} from "@shared/suppliers";
import { reviewTagLabel } from "../lib/reviewTags";

// Uber-style pills: neutral at rest, solid black once picked. A selected tag
// is a statement the couple is making, so it reads as filled-in ink rather
// than as a tinted accent.
const chipCls = (on: boolean) =>
  `rounded-full px-3.5 py-1.5 text-sm transition active:scale-95 ${
    on
      ? "bg-ink-900 text-paper-50 dark:bg-paper-100 dark:text-ink-900"
      : "bg-paper-100 text-ink-800 hover:bg-paper-200 dark:bg-umber-700/60 dark:text-umber-100 dark:hover:bg-umber-700"
  }`;

/** Tag selector for the review composer: category-suggested chips, the couple's
 *  own free-text ("+1") tags, and an input to add more — all capped together at
 *  MAX_REVIEW_TAGS. `value` mixes controlled and free-text tags; the parent just
 *  hands it to the API. Shared by the in-app and public composers. */
export function ReviewTagPicker({
  value,
  onChange,
  category,
  t,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  category: SupplierCategory;
  t: (k: string, vars?: Record<string, string | number>) => string;
}) {
  const [draft, setDraft] = useState("");
  // "Add your own" is a chip until clicked, then the same pill becomes a field.
  const [adding, setAdding] = useState(false);
  const tagOptions = reviewTagsForCategory(category);
  const atCap = value.length >= MAX_REVIEW_TAGS;

  const toggle = (tag: string) => {
    if (value.includes(tag)) onChange(value.filter((x) => x !== tag));
    else if (!atCap) onChange([...value, tag]);
  };

  // Selected tags that aren't among this category's suggestions — a free-text
  // tag, or a known tag that folded in from the input. Rendered as their own
  // removable chips so they stay visible and counted.
  const extras = value.filter((tag) => !(tagOptions as readonly string[]).includes(tag));

  const normalisedDraft = normaliseCustomReviewTag(draft);
  const canAdd =
    !atCap &&
    normalisedDraft !== null &&
    !value.some((tag) => tag.toLowerCase() === normalisedDraft.toLowerCase());

  const addDraft = () => {
    if (!canAdd || normalisedDraft === null) return;
    onChange([...value, normalisedDraft]);
    setDraft("");
    setAdding(false);
  };

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold text-ink-900 dark:text-paper-50">
          {t("suppliers.detail.reviews.tagsPrompt")}
        </span>
        <span className="text-xs tabular-nums text-ink-400 dark:text-umber-400">
          {value.length}/{MAX_REVIEW_TAGS}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {tagOptions.map((tag) => (
          <button
            key={tag}
            type="button"
            aria-pressed={value.includes(tag)}
            onClick={() => toggle(tag)}
            disabled={atCap && !value.includes(tag)}
            className={`${chipCls(value.includes(tag))} disabled:cursor-not-allowed disabled:opacity-40`}
          >
            {t(`suppliers.reviewTags.${tag}`)}
          </button>
        ))}
        {extras.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => toggle(tag)}
            className={`${chipCls(true)} inline-flex items-center gap-1.5`}
            aria-label={`${t("common.remove")}: ${reviewTagLabel(tag, t)}`}
            title={t("common.remove")}
          >
            {reviewTagLabel(tag, t)}
            <span aria-hidden>×</span>
          </button>
        ))}
        {!atCap &&
          (adding ? (
            <input
              type="text"
              autoFocus
              value={draft}
              maxLength={CUSTOM_REVIEW_TAG_MAX_CHARS}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addDraft();
                } else if (e.key === "Escape") {
                  setDraft("");
                  setAdding(false);
                }
              }}
              onBlur={() => {
                if (canAdd) addDraft();
                else {
                  setDraft("");
                  setAdding(false);
                }
              }}
              placeholder={t("suppliers.detail.reviews.customTagPlaceholder")}
              aria-label={t("suppliers.detail.reviews.customTagPlaceholder")}
              className="w-40 rounded-full border border-ink-900 bg-transparent px-3.5 py-1.5 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none dark:border-paper-100 dark:text-paper-50 dark:placeholder:text-umber-400"
            />
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-ink-300 px-3.5 py-1.5 text-sm text-ink-600 transition hover:border-ink-900 hover:text-ink-900 dark:border-umber-600 dark:text-umber-200 dark:hover:border-paper-100 dark:hover:text-paper-50"
            >
              <Plus size={14} strokeWidth={1.75} aria-hidden />
              {t("suppliers.detail.reviews.customTagPlaceholder")}
            </button>
          ))}
      </div>
    </div>
  );
}
