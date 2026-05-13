// Moodboard preview — proxies a public Pinterest board's RSS feed so the
// browser can render the pins without hitting CORS limits or relying on the
// (unreliable) Pinterest widget script. Typed error codes on the response
// body let the frontend show specific copy for private/missing/empty boards.

import { fetchPinterestBoardPins } from "../domain/moodboard";
import { type Ctx, HttpError, json, type Router } from "../lib/http";

async function handlePreview(ctx: Ctx): Promise<Response> {
  const url = new URL(ctx.req.url).searchParams.get("url");
  if (!url) {
    throw new HttpError(400, "url query param required", { code: "invalid_url" });
  }
  const pins = await fetchPinterestBoardPins(url);
  return json({ pins });
}

export function registerMoodboardRoutes(router: Router) {
  router.get("/api/moodboard/preview", handlePreview, true);
}
