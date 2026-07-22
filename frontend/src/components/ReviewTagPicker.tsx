import { useState } from "react";
import {
  CUSTOM_REVIEW_TAG_MAX_CHARS,
  MAX_REVIEW_TAGS,
  normaliseCustomReviewTag,
  reviewTagsForCategory,
  type SupplierCategory,
} from "@shared/suppliers";
import { reviewTagLabel } from "../lib/reviewTags";

const chipCls = (on: boolean) =>
  `rounded-full px-2.5 py-1 text-xs transition ${
    on
      ? "bg-rose-500 text-white"
      : "bg-white text-ink-700 ring-1 ring-ink-200 hover:bg-ink-50 dark:bg-umber-700/60 dark:text-umber-100 dark:ring-umber-600"
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
  };

  return (
    <div className="mb-3">
      <div className="mb-1.5 text-xs text-ink-500 dark:text-umber-300">
        {t("suppliers.detail.reviews.tagsLabel", { max: MAX_REVIEW_TAGS })}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tagOptions.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => toggle(tag)}
            className={chipCls(value.includes(tag))}
          >
            {t(`suppliers.reviewTags.${tag}`)}
          </button>
        ))}
        {extras.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => toggle(tag)}
            className={`${chipCls(true)} inline-flex items-center gap-1`}
            aria-label={t("common.remove")}
            title={t("common.remove")}
          >
            {reviewTagLabel(tag, t)}
            <span aria-hidden>×</span>
          </button>
        ))}
      </div>
      {!atCap && (
        <div className="mt-2 flex items-center gap-1.5">
          <input
            type="text"
            value={draft}
            maxLength={CUSTOM_REVIEW_TAG_MAX_CHARS}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addDraft();
              }
            }}
            placeholder={t("suppliers.detail.reviews.customTagPlaceholder")}
            className="w-44 rounded-full border border-ink-200 bg-white px-3 py-1 text-xs text-ink-800 placeholder:text-ink-400 focus:border-rose-400 focus:outline-none dark:border-umber-700 dark:bg-umber-900 dark:text-umber-100 dark:placeholder:text-umber-400"
          />
          <button
            type="button"
            onClick={addDraft}
            disabled={!canAdd}
            className="rounded-full px-2.5 py-1 text-xs text-ink-700 ring-1 ring-ink-200 transition hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-umber-100 dark:ring-umber-600 dark:hover:bg-umber-700/60"
          >
            {t("suppliers.detail.reviews.customTagAdd")}
          </button>
        </div>
      )}
    </div>
  );
}
