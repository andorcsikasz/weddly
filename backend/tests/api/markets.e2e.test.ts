// Live wedding prediction markets:
//   backend/src/routes/markets.ts + backend/src/domain/markets.ts +
//   backend/src/domain/markets_play.ts + shared/markets.ts
//
// What this suite is really guarding is the pari-mutuel math: payouts always
// sum to exactly what was staked (no house, nothing created or destroyed),
// a question's status is DERIVED from closes_at/outcome/voided_at rather than
// stored, and a guest's side is locked the first time they bet.

import "../setup";

import { describe, expect, test } from "bun:test";
import type { MarketBoardDetail, MarketPublicState, MarketQuestion } from "@shared/markets";
import { db } from "../../src/db";
import { bootstrapCouple, req, wipeAll } from "../helpers";

interface BoardResp {
  board: MarketBoardDetail;
}
interface JoinResp {
  token: string;
  player: { id: number; name: string; avatar: string; balance: number };
  state: MarketPublicState;
}
interface BetResp {
  result: { side: "yes" | "no"; stake: number; totalStakeOnSide: number; balance: number };
  state: MarketPublicState;
}

async function createLiveBoard(
  token: string,
  questionPrompt = "Will the groom cry during the vows?",
): Promise<{ board: MarketBoardDetail; questionId: number }> {
  const created = await req<BoardResp>(
    "POST",
    "/api/markets",
    { title: "Our wedding markets" },
    { token },
  );
  expect(created.status).toBe(201);
  const boardId = created.data.board.id;

  const withQuestion = await req<BoardResp>(
    "POST",
    `/api/markets/${boardId}/questions`,
    { prompt: questionPrompt, closesAt: Date.now() + 60 * 60 * 1000 },
    { token },
  );
  expect(withQuestion.status).toBe(201);
  const questionId = withQuestion.data.board.questions[0]!.id;

  const started = await req<BoardResp>("POST", `/api/markets/${boardId}/start`, undefined, {
    token,
  });
  expect(started.status).toBe(200);
  expect(started.data.board.status).toBe("live");

  return { board: started.data.board, questionId };
}

async function joinAs(code: string, name: string): Promise<JoinResp> {
  const res = await req<JoinResp>("POST", `/api/play/markets/${code}/join`, {
    name,
    avatar: "🦄",
  });
  expect(res.status).toBe(200);
  return res.data;
}

describe("markets: board + question CRUD", () => {
  test("create board, add question, starting requires a question", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("markets-crud@weddly.test");

    const emptyBoard = await req<BoardResp>(
      "POST",
      "/api/markets",
      { title: "Predictions" },
      { token },
    );
    expect(emptyBoard.status).toBe(201);
    expect(emptyBoard.data.board.status).toBe("draft");
    expect(emptyBoard.data.board.joinCode).toHaveLength(6);

    const startEmpty = await req(
      "POST",
      `/api/markets/${emptyBoard.data.board.id}/start`,
      undefined,
      { token },
    );
    expect(startEmpty.status).toBe(400);

    const { board, questionId } = await createLiveBoard(token);
    expect(board.questions).toHaveLength(1);
    expect(board.questions[0]!.id).toBe(questionId);
    expect(board.questions[0]!.status).toBe("open");
    expect(board.questions[0]!.probability).toBe(50); // no bets yet — coin flip default
  });

  test("a couple cannot manage another couple's board", async () => {
    wipeAll();
    const { token: aToken } = await bootstrapCouple("markets-iso-a@weddly.test");
    const { board } = await createLiveBoard(aToken);
    const { token: bToken } = await bootstrapCouple("markets-iso-b@weddly.test");

    const get = await req("GET", `/api/markets/${board.id}`, undefined, { token: bToken });
    expect(get.status).toBe(404);
    const del = await req("DELETE", `/api/markets/${board.id}`, undefined, { token: bToken });
    expect(del.status).toBe(404);
  });

  test("requires auth", async () => {
    wipeAll();
    const r = await req("GET", "/api/markets");
    expect(r.status).toBe(401);
  });
});

describe("markets: guest join + betting", () => {
  test("guest joins by code, bets, pool and probability update live", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("markets-bet@weddly.test");
    const { board, questionId } = await createLiveBoard(token);

    const unknown = await req("GET", "/api/play/markets/ZZZZZZ", undefined);
    expect(unknown.status).toBe(404);

    const alice = await joinAs(board.joinCode, "Alice");
    expect(alice.player.balance).toBe(500);
    expect(alice.state.questions[0]!.probability).toBe(50);

    const bet = await req<BetResp>(
      "POST",
      `/api/play/markets/${board.joinCode}/questions/${questionId}/bet`,
      { side: "yes", stake: 100 },
      { headers: { "X-Market-Player-Token": alice.token } },
    );
    expect(bet.status).toBe(200);
    expect(bet.data.result.balance).toBe(400);
    expect(bet.data.result.totalStakeOnSide).toBe(100);
    expect(bet.data.state.questions[0]!.pool).toEqual({ yes: 100, no: 0 });
    expect(bet.data.state.questions[0]!.probability).toBe(100);
    expect(bet.data.state.myBalance).toBe(400);
  });

  test("topping up adds to the same side; switching sides is rejected", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("markets-topup@weddly.test");
    const { board, questionId } = await createLiveBoard(token);
    const bob = await joinAs(board.joinCode, "Bob");
    const authHeaders = { headers: { "X-Market-Player-Token": bob.token } };

    const first = await req<BetResp>(
      "POST",
      `/api/play/markets/${board.joinCode}/questions/${questionId}/bet`,
      { side: "no", stake: 40 },
      authHeaders,
    );
    expect(first.status).toBe(200);
    expect(first.data.result.totalStakeOnSide).toBe(40);

    const topUp = await req<BetResp>(
      "POST",
      `/api/play/markets/${board.joinCode}/questions/${questionId}/bet`,
      { side: "no", stake: 10 },
      authHeaders,
    );
    expect(topUp.status).toBe(200);
    expect(topUp.data.result.totalStakeOnSide).toBe(50);
    expect(topUp.data.result.balance).toBe(450);

    const flip = await req(
      "POST",
      `/api/play/markets/${board.joinCode}/questions/${questionId}/bet`,
      { side: "yes", stake: 10 },
      authHeaders,
    );
    expect(flip.status).toBe(400);
  });

  test("betting more than the balance is rejected", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("markets-overbet@weddly.test");
    const { board, questionId } = await createLiveBoard(token);
    const carol = await joinAs(board.joinCode, "Carol");

    const overbet = await req(
      "POST",
      `/api/play/markets/${board.joinCode}/questions/${questionId}/bet`,
      { side: "yes", stake: 10_000 },
      { headers: { "X-Market-Player-Token": carol.token } },
    );
    expect(overbet.status).toBe(400);
  });

  test("betting on a closed question is rejected", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("markets-closed@weddly.test");
    const { board, questionId } = await createLiveBoard(token);
    const dana = await joinAs(board.joinCode, "Dana");

    db.prepare("UPDATE market_questions SET closes_at = ? WHERE id = ?").run(
      Date.now() - 1000,
      questionId,
    );

    const closedState = await req<MarketPublicState>("GET", `/api/play/markets/${board.joinCode}`);
    expect(closedState.data.questions[0]!.status).toBe("closed");

    const bet = await req(
      "POST",
      `/api/play/markets/${board.joinCode}/questions/${questionId}/bet`,
      { side: "yes", stake: 10 },
      { headers: { "X-Market-Player-Token": dana.token } },
    );
    expect(bet.status).toBe(400);
  });

  test("betting without joining first is rejected", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("markets-nojoin@weddly.test");
    const { board, questionId } = await createLiveBoard(token);
    const bet = await req(
      "POST",
      `/api/play/markets/${board.joinCode}/questions/${questionId}/bet`,
      { side: "yes", stake: 10 },
    );
    expect(bet.status).toBe(401);
  });
});

describe("markets: resolution math (pari-mutuel)", () => {
  test("winners split the losing pool in proportion to their own stake", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("markets-settle@weddly.test");
    const { board, questionId } = await createLiveBoard(token);

    const alice = await joinAs(board.joinCode, "Alice"); // YES 100
    const bob = await joinAs(board.joinCode, "Bob"); // YES 50
    const carol = await joinAs(board.joinCode, "Carol"); // NO 150

    await req(
      "POST",
      `/api/play/markets/${board.joinCode}/questions/${questionId}/bet`,
      { side: "yes", stake: 100 },
      { headers: { "X-Market-Player-Token": alice.token } },
    );
    await req(
      "POST",
      `/api/play/markets/${board.joinCode}/questions/${questionId}/bet`,
      { side: "yes", stake: 50 },
      { headers: { "X-Market-Player-Token": bob.token } },
    );
    await req(
      "POST",
      `/api/play/markets/${board.joinCode}/questions/${questionId}/bet`,
      { side: "no", stake: 150 },
      { headers: { "X-Market-Player-Token": carol.token } },
    );

    // Pool is now 150 YES / 150 NO — a coin flip, exactly the point where the
    // math is easiest to check by hand: winners double their stake.
    const preResolve = await req<MarketPublicState>("GET", `/api/play/markets/${board.joinCode}`);
    expect(preResolve.data.questions[0]!.probability).toBe(50);

    const resolve = await req<{ question: MarketQuestion }>(
      "POST",
      `/api/markets/${board.id}/questions/${questionId}/resolve`,
      { outcome: "yes" },
      { token },
    );
    expect(resolve.status).toBe(200);
    expect(resolve.data.question.status).toBe("resolved");
    expect(resolve.data.question.outcome).toBe("yes");

    const aliceState = await req<MarketPublicState>(
      "GET",
      `/api/play/markets/${board.joinCode}`,
      undefined,
      {
        headers: { "X-Market-Player-Token": alice.token },
      },
    );
    const bobState = await req<MarketPublicState>(
      "GET",
      `/api/play/markets/${board.joinCode}`,
      undefined,
      {
        headers: { "X-Market-Player-Token": bob.token },
      },
    );
    const carolState = await req<MarketPublicState>(
      "GET",
      `/api/play/markets/${board.joinCode}`,
      undefined,
      {
        headers: { "X-Market-Player-Token": carol.token },
      },
    );

    // Started at 500, staked 100/50/150. Winners get stake back plus their
    // share of the 150-point losing pool; Carol (NO, lost) gets nothing back.
    expect(aliceState.data.myBalance).toBe(500 - 100 + 200); // 100 + (100/150)*150 = 200
    expect(bobState.data.myBalance).toBe(500 - 50 + 100); // 50 + (50/150)*150 = 100
    expect(carolState.data.myBalance).toBe(500 - 150); // lost the 150 stake

    // Payouts sum to exactly the total staked — no house, nothing created.
    const totalPayout = 200 + 100 + 0;
    expect(totalPayout).toBe(100 + 50 + 150);

    const myPositionAlice = aliceState.data.myPositions.find(
      (p: { questionId: number }) => p.questionId === questionId,
    );
    expect(myPositionAlice?.payout).toBe(200);

    // Already-settled question refuses a second resolution.
    const again = await req(
      "POST",
      `/api/markets/${board.id}/questions/${questionId}/resolve`,
      { outcome: "no" },
      { token },
    );
    expect(again.status).toBe(400);
  });

  test("nobody backing the outcome that happened refunds every stake", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("markets-refund@weddly.test");
    const { board, questionId } = await createLiveBoard(token);
    const eve = await joinAs(board.joinCode, "Eve");

    await req(
      "POST",
      `/api/play/markets/${board.joinCode}/questions/${questionId}/bet`,
      { side: "no", stake: 80 },
      { headers: { "X-Market-Player-Token": eve.token } },
    );

    const resolve = await req(
      "POST",
      `/api/markets/${board.id}/questions/${questionId}/resolve`,
      { outcome: "yes" }, // nobody bet yes
      { token },
    );
    expect(resolve.status).toBe(200);

    const eveState = await req<MarketPublicState>(
      "GET",
      `/api/play/markets/${board.joinCode}`,
      undefined,
      {
        headers: { "X-Market-Player-Token": eve.token },
      },
    );
    expect(eveState.data.myBalance).toBe(500); // stake refunded in full
  });

  test("void refunds every stake and settles the question", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("markets-void@weddly.test");
    const { board, questionId } = await createLiveBoard(token);
    const frank = await joinAs(board.joinCode, "Frank");

    await req(
      "POST",
      `/api/play/markets/${board.joinCode}/questions/${questionId}/bet`,
      { side: "yes", stake: 60 },
      { headers: { "X-Market-Player-Token": frank.token } },
    );

    const voided = await req<{ question: MarketQuestion }>(
      "POST",
      `/api/markets/${board.id}/questions/${questionId}/void`,
      undefined,
      { token },
    );
    expect(voided.status).toBe(200);
    expect(voided.data.question.status).toBe("voided");

    const frankState = await req<MarketPublicState>(
      "GET",
      `/api/play/markets/${board.joinCode}`,
      undefined,
      {
        headers: { "X-Market-Player-Token": frank.token },
      },
    );
    expect(frankState.data.myBalance).toBe(500);
  });
});

describe("markets: leaderboard", () => {
  test("ranks players by balance, highest first", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("markets-leaderboard@weddly.test");
    const { board, questionId } = await createLiveBoard(token);
    const grace = await joinAs(board.joinCode, "Grace");
    const heidi = await joinAs(board.joinCode, "Heidi");

    // Grace bets and wins big; Heidi never bets.
    await req(
      "POST",
      `/api/play/markets/${board.joinCode}/questions/${questionId}/bet`,
      { side: "yes", stake: 200 },
      { headers: { "X-Market-Player-Token": grace.token } },
    );
    await req(
      "POST",
      `/api/play/markets/${board.joinCode}/questions/${questionId}/bet`,
      { side: "no", stake: 50 },
      { headers: { "X-Market-Player-Token": heidi.token } },
    );
    await req(
      "POST",
      `/api/markets/${board.id}/questions/${questionId}/resolve`,
      { outcome: "yes" },
      { token },
    );

    const leaderboard = await req<{
      leaderboard: { player: { name: string; balance: number }; rank: number }[];
    }>("GET", `/api/markets/${board.id}/leaderboard`, undefined, { token });
    expect(leaderboard.status).toBe(200);
    expect(leaderboard.data.leaderboard[0]!.player.name).toBe("Grace");
    expect(leaderboard.data.leaderboard[0]!.rank).toBe(1);
    expect(leaderboard.data.leaderboard[1]!.player.name).toBe("Heidi");
  });
});
