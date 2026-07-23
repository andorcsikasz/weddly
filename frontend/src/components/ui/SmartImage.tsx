import { type ImgHTMLAttributes, type ReactEventHandler, useState } from "react";

type SmartImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "className"> & {
  /** Classes for the <img> itself. */
  className?: string;
  /** Classes for the wrapper <span> (sizing, e.g. "h-full w-full"). */
  wrapperClassName?: string;
  /** Classes applied to the wrapper ONLY while loading — use to reserve space
   *  in a fluid grid whose images carry no intrinsic dimensions (e.g. a
   *  masonry column: "aspect-[3/4]"). Dropped once the image settles so the
   *  real, natural-height pixels take over. */
  loadingClassName?: string;
  /** Extra classes for the shimmer overlay (rarely needed). */
  skeletonClassName?: string;
};

/** An <img> that shows a shimmer skeleton until it loads (or errors), then
 *  fades the real pixels in. On an image grid a bare <img> over a tinted box is
 *  visually identical to a no-content placeholder for the second or two the
 *  fetch takes, so "loading" and "empty" become indistinguishable — this makes
 *  loading legible. Already-cached images settle synchronously (complete on the
 *  ref) so they never flash a skeleton. */
export function SmartImage({
  className = "",
  wrapperClassName = "",
  loadingClassName = "",
  skeletonClassName = "",
  onLoad,
  onError,
  ...imgProps
}: SmartImageProps) {
  const [settled, setSettled] = useState(false);
  const markSettled = () => setSettled(true);
  const handleLoad: ReactEventHandler<HTMLImageElement> = (e) => {
    markSettled();
    onLoad?.(e);
  };
  const handleError: ReactEventHandler<HTMLImageElement> = (e) => {
    // Settle on error too: keep the broken-image glyph rather than an eternal
    // shimmer that reads as "still loading".
    markSettled();
    onError?.(e);
  };
  return (
    <span
      className={`relative block overflow-hidden ${wrapperClassName} ${settled ? "" : loadingClassName}`}
    >
      {!settled && (
        <span
          aria-hidden="true"
          className={`absolute inset-0 skeleton motion-safe:animate-shimmer ${skeletonClassName}`}
        />
      )}
      <img
        {...imgProps}
        ref={(el) => {
          // Cached images are already complete before React wires onLoad.
          if (el?.complete && el.naturalWidth > 0) markSettled();
        }}
        className={`${className} transition-opacity duration-300 ${settled ? "opacity-100" : "opacity-0"}`}
        onLoad={handleLoad}
        onError={handleError}
      />
    </span>
  );
}
