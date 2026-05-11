// Public suppliers directory. Merges the static curated list with active
// user-submitted entries, then overlays per-supplier vote tallies + the
// caller's own vote. Anonymous callers get votes_score but user_vote = 0.

import type { DirectorySupplier, DirectorySupplierBase, SupplierCategory } from "@shared/suppliers";
import {
  listActiveCommunitySuppliers,
  toDirectorySupplierBase,
} from "../domain/community_suppliers";
import { DIRECTORY } from "../domain/suppliers_data";
import { getScoresMap, getUserVotesMap, setVote, type VoteValue } from "../domain/supplier_votes";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";

const VALID_CATEGORIES: ReadonlySet<SupplierCategory> = new Set([
  "venue",
  "accommodation",
  "catering",
  "cake_dessert",
  "bar_drinks",
  "decor_floral",
  "lighting",
  "music_dj",
  "photo_video",
  "entertainment",
  "attire",
  "hair_makeup",
  "stationery",
  "transport",
]);

function withVotes(
  base: DirectorySupplierBase,
  scores: Map<string, number>,
  votes: Map<string, VoteValue> | null,
): DirectorySupplier {
  return {
    ...base,
    votes_score: scores.get(base.id) ?? 0,
    user_vote: (votes?.get(base.id) ?? 0) as -1 | 0 | 1,
  };
}

async function handleList(ctx: Ctx): Promise<Response> {
  const cat = ctx.url.searchParams.get("category");
  const curated = cat ? DIRECTORY.filter((s) => s.category === cat) : DIRECTORY;
  const community = listActiveCommunitySuppliers((cat as SupplierCategory | null) ?? null);
  const allBase: DirectorySupplierBase[] = [...curated, ...community.map(toDirectorySupplierBase)];

  const scores = getScoresMap();
  const userVotes = ctx.userId ? getUserVotesMap(ctx.userId) : null;

  return json({ suppliers: allBase.map((b) => withVotes(b, scores, userVotes)) });
}

interface VoteBody {
  value?: unknown;
}

async function handleVote(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const supplierId = ctx.params.supplier_id?.trim();
  if (!supplierId) throw new HttpError(400, "supplier_id required");
  if (supplierId.length > 80) throw new HttpError(400, "supplier_id too long");

  // The id must reference something in the public list — either a curated slug
  // or an active community entry. Without this guard we'd accept votes for
  // garbage ids that no card ever shows.
  const isCurated = DIRECTORY.some((s) => s.id === supplierId);
  if (!isCurated) {
    if (!supplierId.startsWith("c")) throw new HttpError(404, "Unknown supplier");
    const community = listActiveCommunitySuppliers();
    if (!community.some((c) => `c${c.id}` === supplierId)) {
      throw new HttpError(404, "Unknown supplier");
    }
  }

  const body = await readJson<VoteBody>(ctx.req);
  const raw = body.value;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (n !== -1 && n !== 0 && n !== 1) {
    throw new HttpError(400, "value must be -1, 0, or 1");
  }
  setVote(userId, supplierId, n as VoteValue);

  // Echo the fresh tally so the frontend can sync optimistically.
  const scores = getScoresMap();
  return json({
    supplier_id: supplierId,
    votes_score: scores.get(supplierId) ?? 0,
    user_vote: n,
  });
}

export function registerSupplierRoutes(router: Router) {
  router.get("/api/suppliers", handleList);
  router.put("/api/suppliers/:supplier_id/vote", handleVote, true);
  // Silence the unused-import warning for VALID_CATEGORIES; it's left here
  // so a future "validate cat param" path is one line away.
  void VALID_CATEGORIES;
}
