import { BlogCoverArt } from "./BlogCoverArt";

export function BlogCover({
  url,
  slug,
  category,
  lazy,
}: {
  url: string | null;
  /** Accepted for API compatibility — the SVG cover is aria-hidden and the
   * card heading supplies the accessible name. */
  alt?: string;
  slug?: string;
  category?: string;
  lazy?: boolean;
}) {
  return (
    <div className="aspect-[16/10] w-full overflow-hidden bg-paper-100 dark:bg-umber-800">
      <BlogCoverArt
        slug={slug}
        bgUrl={url}
        category={category}
        lazy={lazy}
        className="h-full w-full transition-transform duration-500 group-hover:scale-[1.02]"
      />
    </div>
  );
}
