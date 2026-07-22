import { isKnownReviewTag } from "@shared/suppliers";

/** A review tag is either a controlled-vocabulary member (localised label) or a
 *  couple's free-text ("+1") tag (rendered verbatim). Never feed a free-text
 *  tag through `t("suppliers.reviewTags.<tag>")` — the key won't exist and `t`
 *  would echo the raw path. */
export function reviewTagLabel(
  tag: string,
  t: (k: string, vars?: Record<string, string | number>) => string,
): string {
  return isKnownReviewTag(tag) ? t(`suppliers.reviewTags.${tag}`) : tag;
}
