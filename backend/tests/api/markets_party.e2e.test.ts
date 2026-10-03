// Prediction markets, party mode: question packs, the live bet ticker,
// reactions, teams, bail-outs, the pity loan, the reveal summary and the
// leaderboard awards. See backend/src/domain/markets_play.ts.
//
// The invariant this suite guards beside the features themselves: points are
// never minted except by the one capped pity loan. A bail-out burns its
// haircut, awards pay nothing, and a settlement still pays out exactly the
// pool.

import "../setup";

import { describe, expect, test } from "bun:test";
import { MARKET_PITY_LOAN, type MarketBoardDetail, type MarketPublicState } from "@shared/markets";
import { bootstrapCouple, req, wipeAll } from "../helpers";

interface BoardResp {
  board: MarketBoardDetail;
}
interface JoinResp {
  token: string;
  player: { id: number; balance: number };
  state: MarketPublicState;
}
interface StateResp {
  state: MarketPublicState;
}

const HOUR = 60 * 60 * 1000;

async function liveBoard(token: string, prompts = ["Will the groom cry?"]) {
  const created = await req<BoardResp>("POST", "/api/markets", { title: "Party" }, { token });
  const boardId = created.data.board.id;
  const bulk = await req<BoardResp>(
    "POST",
    `/api/markets/${boardId}/questions/bulk`,
    { questions: prompts.map((prompt) => ({ prompt })), closesAt: Date.now() + HOUR },
    { token },
  );
  expect(bulk.status).toBe(201);
  const started = await req<BoardResp>("POST", `/api/markets/${boardId}/start`, undefined, {
    token,
  });
  return started.data.board;
}

async function join(code: string, name: string, team?: string): Promise<JoinResp> {
  const res = await req<JoinResp>("POST", `/api/play/markets/${code}/join`, {
    name,
    avatar: "🦄",
    team,
  });
  expect(res.status).toBe(200);
  return res.data;
}

function play<T>(path: string, token: string, body: unknown = {}) {
  return req<T>("POST", path, body, { headers: { "X-Market-Player-Token": token } });
}

describe("markets party: the couple's board", () => {
  // The page used to list-then-create from the browser, so a double mount
  // minted two boards. The server now owns "get or create".
  test("current returns the same board however often it is asked", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("party-ensure@weddly.test");
    const first = await req<BoardResp>(
      "POST",
      "/api/markets/current",
      { title: "Bets" },
      { token },
    );
    expect(first.status).toBe(201);
    const [a, b] = await Promise.all([
      req<BoardResp>("POST", "/api/markets/current", { title: "Bets" }, { token }),
      req<BoardResp>("POST", "/api/markets/current", { title: "Bets" }, { token }),
    ]);
    expect(a.status).toBe(200);
    expect(a.data.board.id).toBe(first.data.board.id);
    expect(b.data.board.id).toBe(first.data.board.id);
    const list = await req<{ boards: unknown[] }>("GET", "/api/markets", undefined, { token });
    expect(list.data.boards).toHaveLength(1);
  });
});

describe("markets party: question packs", () => {
  test("a pack lands whole, and one bad entry rejects all of it", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("party-pack@weddly.test");
    const created = await req<BoardResp>("POST", "/api/markets", { title: "P" }, { token });
    const id = created.data.board.id;

    const bad = await req(
      "POST",
      `/api/markets/${id}/questions/bulk`,
      {
        questions: [{ prompt: "Fine?" }, { prompt: "Bad odds?", openingProbability: 100 }],
        closesAt: Date.now() + HOUR,
      },
      { token },
    );
    expect(bad.status).toBe(400);
    const after = await req<BoardResp>("GET", `/api/markets/${id}`, undefined, { token });
    expect(after.data.board.questions).toHaveLength(0);

    const ok = await req<BoardResp>(
      "POST",
      `/api/markets/${id}/questions/bulk`,
      {
        questions: [
          { prompt: "First dance over 3 min?", openingProbability: 70 },
          { prompt: "Rain?" },
        ],
        closesAt: Date.now() + HOUR,
      },
      { token },
    );
    expect(ok.status).toBe(201);
    expect(ok.data.board.questions.map((q) => q.openingProbability)).toEqual([70, 50]);
  });

  test("the prize is set, cleared, and shown to guests", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("party-prize@weddly.test");
    const board = await liveBoard(token);
    const set = await req<BoardResp>(
      "PATCH",
      `/api/markets/${board.id}`,
      { prize: "Winner picks the next song" },
      { token },
    );
    expect(set.status).toBe(200);
    const lookup = await req<MarketPublicState>("GET", `/api/play/markets/${board.joinCode}`);
    expect(lookup.data.prize).toBe("Winner picks the next song");

    await req("PATCH", `/api/markets/${board.id}`, { prize: "" }, { token });
    const cleared = await req<MarketPublicState>("GET", `/api/play/markets/${board.joinCode}`);
    expect(cleared.data.prize).toBeNull();
  });
});

describe("markets party: big-screen QR", () => {
  test("the join QR is public for a real code and 404s for a made-up one", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("party-qr@weddly.test");
    const board = await liveBoard(token);
    const ok = await fetch(
      `http://localhost:${process.env.PORT ?? "8791"}/api/play/markets/${board.joinCode}/qr`,
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");
    await ok.arrayBuffer();
    const missing = await req("GET", "/api/play/markets/ZZZZZZ/qr");
    expect(missing.status).toBe(404);
  });
});

describe("markets party: ticker, teams, reactions", () => {
  test("bets show in the ticker, teams total their balances, reactions float and cool down", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("party-ticker@weddly.test");
    const board = await liveBoard(token);
    const qid = board.questions[0]!.id;
    const kati = await join(board.joinCode, "Kati", "bride");
    const peti = await join(board.joinCode, "Peti", "groom");
    await join(board.joinCode, "Nobody", "villain"); // unknown team is simply no team

    await play(`/api/play/markets/${board.joinCode}/questions/${qid}/bet`, kati.token, {
      side: "no",
      stake: 200,
    });
    const r = await play<StateResp>(
      `/api/play/markets/${board.joinCode}/questions/${qid}/bet`,
      peti.token,
      { side: "yes", stake: 50 },
    );
    const state = (r.data as unknown as { state: MarketPublicState }).state;
    expect(state.recentBets.map((b) => [b.name, b.side, b.stake])).toEqual([
      ["Peti", "yes", 50],
      ["Kati", "no", 200],
    ]);
    expect(state.teams).toEqual([
      { team: "bride", players: 1, balance: 300 },
      { team: "groom", players: 1, balance: 450 },
    ]);
    expect(state.me?.team).toBe("groom");

    const react = await play<{ stored: boolean }>(
      `/api/play/markets/${board.joinCode}/react`,
      kati.token,
      { emoji: "😂" },
    );
    expect(react.data.stored).toBe(true);
    const tooFast = await play<{ stored: boolean }>(
      `/api/play/markets/${board.joinCode}/react`,
      kati.token,
      { emoji: "🔥" },
    );
    expect(tooFast.data.stored).toBe(false);
    const unknown = await play(`/api/play/markets/${board.joinCode}/react`, kati.token, {
      emoji: "💩",
    });
    expect(unknown.status).toBe(400);

    const screen = await req<MarketPublicState>("GET", `/api/play/markets/${board.joinCode}`);
    expect(screen.data.reactions.map((x) => [x.emoji, x.name])).toEqual([["😂", "Kati"]]);
    expect(screen.data.me).toBeNull();
  });
});

describe("markets party: bail-out", () => {
  test("refunds 80%, burns the rest, frees the player to switch sides", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("party-bailout@weddly.test");
    const board = await liveBoard(token);
    const qid = board.questions[0]!.id;
    const kati = await join(board.joinCode, "Kati");
    const base = `/api/play/markets/${board.joinCode}/questions/${qid}`;

    const none = await play(`${base}/bailout`, kati.token);
    expect(none.status).toBe(400);

    await play(`${base}/bet`, kati.token, { side: "yes", stake: 100 });
    const out = await play<{ result: { refund: number }; state: MarketPublicState }>(
      `${base}/bailout`,
      kati.token,
    );
    expect(out.status).toBe(200);
    expect(out.data.result.refund).toBe(80);
    expect(out.data.state.myBalance).toBe(480);
    expect(out.data.state.questions[0]!.pool).toEqual({ yes: 0, no: 0 });

    // Freed: the other side is allowed now.
    const flip = await play<StateResp>(`${base}/bet`, kati.token, { side: "no", stake: 50 });
    expect(flip.status).toBe(200);

    // Alone in the room there is nobody to out-do, so no awards yet...
    const alone = await req<MarketPublicState>("GET", `/api/play/markets/${board.joinCode}`);
    expect(alone.data.leaderboard[0]!.titles).toEqual([]);

    // ...and a second player makes it a contest.
    await join(board.joinCode, "Peti");
    const lb = await req<MarketPublicState>("GET", `/api/play/markets/${board.joinCode}`);
    const katiEntry = lb.data.leaderboard.find((e) => e.player.name === "Kati")!;
    expect(katiEntry.titles).toContain("bailout_king");
  });
});

describe("markets party: pity loan", () => {
  test("only a truly broke player gets it, and only once", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("party-pity@weddly.test");
    const board = await liveBoard(token, ["Q1?", "Q2?"]);
    const [q1, q2] = board.questions;
    const kati = await join(board.joinCode, "Kati");
    const peti = await join(board.joinCode, "Peti");
    const pity = `/api/play/markets/${board.joinCode}/pity`;

    const rich = await play(pity, kati.token);
    expect(rich.status).toBe(400);

    // All in on Q1 while it is still open: broke, but a bet is riding, so no loan.
    await play(`/api/play/markets/${board.joinCode}/questions/${q1!.id}/bet`, kati.token, {
      side: "yes",
      stake: 500,
    });
    await play(`/api/play/markets/${board.joinCode}/questions/${q1!.id}/bet`, peti.token, {
      side: "no",
      stake: 10,
    });
    const riding = await play(pity, kati.token);
    expect(riding.status).toBe(400);

    await req(
      "POST",
      `/api/markets/${board.id}/questions/${q1!.id}/resolve`,
      { outcome: "no" },
      {
        token,
      },
    );
    const s = await req<MarketPublicState>(
      "GET",
      `/api/play/markets/${board.joinCode}/state`,
      undefined,
      {
        headers: { "X-Market-Player-Token": kati.token },
      },
    );
    expect(s.data.myBalance).toBe(0);
    expect(s.data.me?.pityAvailable).toBe(true);

    const loan = await play<{ result: { balance: number }; state: MarketPublicState }>(
      pity,
      kati.token,
    );
    expect(loan.status).toBe(200);
    expect(loan.data.result.balance).toBe(MARKET_PITY_LOAN);
    expect(loan.data.state.me?.pityAvailable).toBe(false);

    // Lose it again: still no second loan.
    await play(`/api/play/markets/${board.joinCode}/questions/${q2!.id}/bet`, kati.token, {
      side: "yes",
      stake: MARKET_PITY_LOAN,
    });
    await play(`/api/play/markets/${board.joinCode}/questions/${q2!.id}/bet`, peti.token, {
      side: "no",
      stake: 10,
    });
    await req(
      "POST",
      `/api/markets/${board.id}/questions/${q2!.id}/resolve`,
      { outcome: "no" },
      {
        token,
      },
    );
    const again = await play(pity, kati.token);
    expect(again.status).toBe(400);
  });
});

describe("markets party: reveal summary and awards", () => {
  test("a resolved question names its biggest winner; awards pay nothing", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("party-reveal@weddly.test");
    const board = await liveBoard(token);
    const qid = board.questions[0]!.id;
    const a = await join(board.joinCode, "Anna");
    const b = await join(board.joinCode, "Bence");
    const c = await join(board.joinCode, "Csilla");
    const d = await join(board.joinCode, "Dani");
    const bet = (t: string, side: string, stake: number) =>
      play(`/api/play/markets/${board.joinCode}/questions/${qid}/bet`, t, { side, stake });

    // Anna alone backs YES against a crowd: an oracle call when YES wins.
    await bet(a.token, "yes", 50);
    await bet(b.token, "no", 100);
    await bet(c.token, "no", 100);
    await bet(d.token, "no", 300);

    await req(
      "POST",
      `/api/markets/${board.id}/questions/${qid}/resolve`,
      { outcome: "yes" },
      {
        token,
      },
    );
    const s = await req<MarketPublicState>("GET", `/api/play/markets/${board.joinCode}`);
    const q = s.data.questions[0]!;
    expect(q.settlement).toEqual({
      winnerCount: 1,
      biggestWinner: { name: "Anna", avatar: "🦄", profit: 500 },
    });

    const byName = new Map(s.data.leaderboard.map((e) => [e.player.name, e]));
    expect(byName.get("Anna")!.titles).toEqual(expect.arrayContaining(["prophet", "oracle"]));
    expect(byName.get("Dani")!.titles).toEqual(
      expect.arrayContaining(["degenerate", "rock_bottom"]),
    );
    // Awards are bragging rights: balances still sum to exactly what was handed out.
    const total = s.data.leaderboard.reduce((sum, e) => sum + e.player.balance, 0);
    expect(total).toBe(4 * 500);
  });
});

describe("markets party: settling a live question", () => {
  test("an open question can be called early, and a unanimous win names nobody", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("party-early@weddly.test");
    const board = await liveBoard(token);
    const qid = board.questions[0]!.id;
    const a = await join(board.joinCode, "Anna");
    const b = await join(board.joinCode, "Bence");
    for (const p of [a, b]) {
      await play(`/api/play/markets/${board.joinCode}/questions/${qid}/bet`, p.token, {
        side: "yes",
        stake: 40,
      });
    }
    // Still an hour before the lock: the moment happened, the couple calls it.
    const r = await req(
      "POST",
      `/api/markets/${board.id}/questions/${qid}/resolve`,
      { outcome: "yes" },
      {
        token,
      },
    );
    expect(r.status).toBe(200);
    const s = await req<MarketPublicState>("GET", `/api/play/markets/${board.joinCode}`);
    expect(s.data.questions[0]!.settlement).toEqual({ winnerCount: 2, biggestWinner: null });
    // Late bets bounce off a settled question.
    const late = await play(`/api/play/markets/${board.joinCode}/questions/${qid}/bet`, a.token, {
      side: "yes",
      stake: 10,
    });
    expect(late.status).toBe(400);
  });
});
