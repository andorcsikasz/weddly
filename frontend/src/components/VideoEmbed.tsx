// Lazy, click-to-play video embed for the public supplier detail page.
//
// Renders the provider thumbnail (an <img>, so the browser lazy-loads it and
// no third-party iframe/JS runs) with a play badge. The heavy YouTube iframe
// is only mounted on the first click, so a listing with several videos costs
// one <img> each on load instead of several autoplaying players. Everything is
// derived from `provider` + `video_id` via shared/listing_videos.ts, so a
// future Vimeo video renders here with zero changes.

import { useState } from "react";
import { Play } from "lucide-react";
import { type ListingVideo, videoEmbedUrl, videoThumbnailUrl } from "@shared/listing_videos";

export function LazyVideoPlayer({ video, title }: { video: ListingVideo; title: string }) {
  const [playing, setPlaying] = useState(false);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-ink-900 ring-1 ring-paper-200 dark:ring-umber-700">
      {playing ? (
        <iframe
          src={videoEmbedUrl(video, { autoplay: true })}
          title={title}
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
          className="absolute inset-0 h-full w-full border-0"
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          aria-label={title}
          className="group absolute inset-0 h-full w-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
        >
          <img
            src={videoThumbnailUrl(video)}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
          />
          {/* Scrim + centred play glyph. The scrim lifts contrast for the badge
              and darkens on hover so the affordance reads as clickable. */}
          <span className="absolute inset-0 bg-ink-900/25 transition group-hover:bg-ink-900/35" />
          <span className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-ink-900 shadow-lg transition group-hover:scale-110 group-hover:bg-white">
            <Play size={24} className="ml-0.5 fill-current" aria-hidden />
          </span>
        </button>
      )}
    </div>
  );
}
