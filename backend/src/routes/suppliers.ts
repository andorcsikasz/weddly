// Public suppliers directory. Merges the static curated list with active
// user-submitted entries, then overlays per-supplier vote tallies + the
// caller's own vote. Anonymous callers get votes_score but user_vote = 0.

import type {
  DirectorySupplier,
  DirectorySupplierBase,
  SupplierCategory,
  SupplierEventInput,
} from "@shared/suppliers";
import {
  listActiveCommunitySuppliers,
  toDirectorySupplierBase,
} from "../domain/community_suppliers";
import { getCoupleForUser } from "../domain/couples";
import { DIRECTORY } from "../domain/suppliers_data";
import { getCoupleVotesMap, getScoresMap, setVote, type VoteValue } from "../domain/supplier_votes";
import { recordSupplierEvents } from "../domain/supplier_views";
import { db } from "../db";
import { getUserById } from "../domain/users";
import { type Ctx, HttpError, json, readJson, requireVerifiedAuth, type Router } from "../lib/http";
import { rateLimit } from "../lib/rate_limit";

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
  coupleVotes: Map<string, VoteValue> | null,
): DirectorySupplier {
  return {
    ...base,
    votes_score: scores.get(base.id) ?? 0,
    user_vote: (coupleVotes?.get(base.id) ?? 0) as -1 | 0 | 1,
  };
}

async function handleList(ctx: Ctx): Promise<Response> {
  const cat = ctx.url.searchParams.get("category");
  const curated = cat ? DIRECTORY.filter((s) => s.category === cat) : DIRECTORY;
  const community = listActiveCommunitySuppliers((cat as SupplierCategory | null) ?? null);
  const allBase: DirectorySupplierBase[] = [...curated, ...community.map(toDirectorySupplierBase)];

  const scores = getScoresMap();
  // user_vote is now per-couple — both partners see the same "+1" once either
  // casts it. Anonymous callers and signed-in users without a workspace get
  // `user_vote: 0` everywhere.
  const couple = ctx.userId ? getCoupleForUser(ctx.userId) : null;
  const coupleVotes = couple ? getCoupleVotesMap(couple.id) : null;

  return json({ suppliers: allBase.map((b) => withVotes(b, scores, coupleVotes)) });
}

interface VoteBody {
  value?: unknown;
}

async function handleVote(ctx: Ctx): Promise<Response> {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const supplierId = ctx.params.supplier_id?.trim();
  if (!supplierId) throw new HttpError(400, "supplier_id required");
  if (supplierId.length > 80) throw new HttpError(400, "supplier_id too long");

  // Votes are per-couple — a user without a workspace has no slot to vote
  // into. Returning 403 surfaces the constraint instead of letting the row
  // land with a null couple_id and silently fail the unique index.
  const couple = getCoupleForUser(userId);
  if (!couple) {
    throw new HttpError(403, "Join or create a couple workspace to vote", {
      code: "no_couple",
    });
  }

  // The id must reference something in the public list — either a curated slug
  // or an active community entry. Without this guard we'd accept votes for
  // garbage ids that no card ever shows.
  const isCurated = DIRECTORY.some((s) => s.id === supplierId);
  if (!isCurated) {
    if (!supplierId.startsWith("c")) throw new HttpError(404, "Unknown supplier");
    const community = listActiveCommunitySuppliers();
    const communityMatch = community.find((c) => `c${c.id}` === supplierId);
    if (!communityMatch) {
      throw new HttpError(404, "Unknown supplier");
    }
    // Self-vote block: refuse votes on a community supplier whose submitter
    // is a member of the voting couple (either partner). Without this the
    // submitter's workspace gets a free +1 the moment they finish the form,
    // and "Top voted" becomes a self-listing leaderboard.
    if (communityMatch.submitter_user_id) {
      const submitter = db
        .prepare("SELECT couple_id FROM users WHERE id = ?")
        .get(communityMatch.submitter_user_id) as { couple_id: number | null } | undefined;
      if (submitter && submitter.couple_id === couple.id) {
        throw new HttpError(403, "Can't vote on your own submission", {
          code: "self_vote",
        });
      }
    }
  }

  const body = await readJson<VoteBody>(ctx.req);
  const raw = body.value;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (n !== -1 && n !== 0 && n !== 1) {
    throw new HttpError(400, "value must be -1, 0, or 1");
  }
  setVote(couple.id, userId, supplierId, n as VoteValue);

  // Echo the fresh tally so the frontend can sync optimistically.
  const scores = getScoresMap();
  return json({
    supplier_id: supplierId,
    votes_score: scores.get(supplierId) ?? 0,
    user_vote: n,
  });
}

interface EventsBody {
  events?: unknown;
}

/** Batched ingest for directory analytics. Anonymous-tolerant — a logged-out
 *  visitor still counts toward views. We rate-limit per IP so a single
 *  client can't flood the table; the cap is generous (60 batches/min) since
 *  the frontend sends one batch per page-load. */
async function handleRecordEvents(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "suppliers.events", { capacity: 60, refillRate: 1 });
  const body = await readJson<EventsBody>(ctx.req).catch(() => ({}) as EventsBody);
  if (!Array.isArray(body.events)) {
    throw new HttpError(400, "events must be an array");
  }
  if (body.events.length > 200) {
    throw new HttpError(400, "events batch too large (max 200)");
  }
  const coupleId = ctx.userId ? (getCoupleForUser(ctx.userId)?.id ?? null) : null;
  const written = recordSupplierEvents(
    body.events as SupplierEventInput[],
    ctx.userId ?? null,
    coupleId,
  );
  return json({ recorded: written });
}

export function registerSupplierRoutes(router: Router) {
  router.get("/api/suppliers", handleList);
  router.post("/api/suppliers/events", handleRecordEvents);
  router.put("/api/suppliers/:supplier_id/vote", handleVote, true);
  // Silence the unused-import warning for VALID_CATEGORIES; it's left here
  // so a future "validate cat param" path is one line away.
  void VALID_CATEGORIES;
}
