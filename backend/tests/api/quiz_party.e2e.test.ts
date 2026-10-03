// Live quiz, party upgrades: answer streaks with a capped bonus, rank
// movement and reveal stats, a guest's own result held server-side, the lobby
// roster, and template slides landed in bulk. See backend/src/domain/quiz.ts
// and quiz_play.ts.

import "../setup";

import { describe, expect, test } from "bun:test";
import {
  QUIZ_DEFAULT_POINTS,
  type QuizAnswerResult,
  type QuizDetail,
  type QuizHostState,
  type QuizPublicState,
  quizStreakBonus,
} from "@shared/quiz";
import { bootstrapCouple, req, wipeAll } from "../helpers";

const HEADER = "X-Quiz-Player-Token";

// Untimed slides pay a flat QUIZ_DEFAULT_POINTS, which keeps the arithmetic
// here exact instead of depending on how fast the test runner answers.
function mcq(prompt: string, correctIndex: number | null) {
  return {
    kind: "mcq",
    prompt,
    timeLimitS: null,
    config: { options: ["A", "B", "C", "D"], correctIndex },
  };
}

async function liveQuiz(token: string, slides: Record<string, unknown>[]) {
  const created = await req<{ quiz: QuizDetail }>(
    "POST",
    "/api/quizzes",
    { title: "Q" },
    { token },
  );
  const id = created.data.quiz.id;
  const bulk = await req<{ quiz: QuizDetail }>(
    "POST",
    `/api/quizzes/${id}/slides/bulk`,
    { slides },
    { token },
  );
  expect(bulk.status).toBe(201);
  await req("POST", `/api/quizzes/${id}/host/start`, {}, { token });
  return { id, code: bulk.data.quiz.joinCode, slides: bulk.data.quiz.slides };
}

async function join(code: string, name: string) {
  const r = await req<{ token: string; player: { id: number } }>("POST", `/api/play/${code}/join`, {
    name,
    avatar: "🦄",
  });
  expect(r.status).toBe(200);
  return r.data;
}

const host = (token: string, id: number, action: string, body: unknown = {}) =>
  req<QuizHostState>("POST", `/api/quizzes/${id}/host/${action}`, body, { token });

const answer = (code: string, t: string, slideId: number, optionIndex: number) =>
  req<QuizAnswerResult>(
    "POST",
    `/api/play/${code}/answer`,
    { slideId, value: { kind: "mcq", optionIndex } },
    { headers: { [HEADER]: t } },
  );

const guestState = (code: string, t: string) =>
  req<QuizPublicState>("GET", `/api/play/${code}/state`, undefined, { headers: { [HEADER]: t } });

describe("quiz party: template slides in bulk", () => {
  test("all land together, or none do", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("quizparty-bulk@weddly.test");
    const created = await req<{ quiz: QuizDetail }>(
      "POST",
      "/api/quizzes",
      { title: "T" },
      { token },
    );
    const id = created.data.quiz.id;
    const bad = await req(
      "POST",
      `/api/quizzes/${id}/slides/bulk`,
      {
        slides: [
          mcq("Fine", 0),
          { kind: "mcq", prompt: "Broken", config: { options: ["Only one"] } },
        ],
      },
      { token },
    );
    expect(bad.status).toBe(400);
    const after = await req<{ quiz: QuizDetail }>("GET", `/api/quizzes/${id}`, undefined, {
      token,
    });
    expect(after.data.quiz.slides).toHaveLength(0);

    const ok = await req<{ quiz: QuizDetail }>(
      "POST",
      `/api/quizzes/${id}/slides/bulk`,
      { slides: [{ kind: "section", prompt: "Round 1" }, mcq("Who proposed?", 1)] },
      { token },
    );
    expect(ok.status).toBe(201);
    expect(ok.data.quiz.slides.map((s) => s.kind)).toEqual(["section", "mcq"]);
  });
});

describe("quiz party: streaks", () => {
  test("a streak builds a capped bonus, a miss or wrong answer breaks it, and it never leaks mid-question", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("quizparty-streak@weddly.test");
    const { id, code, slides } = await liveQuiz(token, [
      mcq("Q1", 0),
      mcq("Opinion", null),
      mcq("Q2", 0),
      mcq("Q3", 0),
      mcq("Q4", 0),
    ]);
    const anna = await join(code, "Anna");
    const bence = await join(code, "Bence");

    // Q1: both right.
    await host(token, id, "begin-slide", { slideId: "next" });
    const a1 = await answer(code, anna.token, slides[0]!.id, 0);
    expect(a1.data).toMatchObject({
      correct: true,
      streak: 1,
      bonus: 0,
      points: QUIZ_DEFAULT_POINTS,
    });
    await answer(code, bence.token, slides[0]!.id, 0);
    await host(token, id, "reveal");

    // Opinion slide: unscored, so it neither builds nor breaks anything.
    await host(token, id, "begin-slide", { slideId: "next" });
    const op = await answer(code, anna.token, slides[1]!.id, 2);
    expect(op.data).toMatchObject({ correct: null, streak: 1, bonus: 0, points: 0 });
    await host(token, id, "reveal");

    // Q2: Anna right again (streak 2, bonus), Bence skips it entirely.
    await host(token, id, "begin-slide", { slideId: "next" });
    const a2 = await answer(code, anna.token, slides[2]!.id, 0);
    expect(a2.data).toMatchObject({ streak: 2, bonus: quizStreakBonus(2) });
    expect(a2.data.points).toBe(QUIZ_DEFAULT_POINTS + quizStreakBonus(2));
    // Mid-question the leaderboard still shows the streak from BEFORE Q2,
    // or it would tell the room who just got it right.
    const mid = await req<QuizHostState>("GET", `/api/quizzes/${id}/host-state`, undefined, {
      token,
    });
    expect(mid.data.leaderboard.find((e) => e.player.name === "Anna")!.streak).toBe(1);
    await host(token, id, "reveal");

    const revealed = await req<QuizHostState>("GET", `/api/quizzes/${id}/host-state`, undefined, {
      token,
    });
    const byName = new Map(revealed.data.leaderboard.map((e) => [e.player.name, e]));
    expect(byName.get("Anna")!.streak).toBe(2);
    expect(byName.get("Bence")!.streak).toBe(0); // skipping breaks it

    // Q3: Bence starts again from 1, not from his old streak.
    await host(token, id, "begin-slide", { slideId: "next" });
    const b3 = await answer(code, bence.token, slides[3]!.id, 0);
    expect(b3.data.streak).toBe(1);
    const a3 = await answer(code, anna.token, slides[3]!.id, 1); // wrong
    expect(a3.data).toMatchObject({ correct: false, streak: 0, bonus: 0, points: 0 });
    await host(token, id, "reveal");

    expect(quizStreakBonus(20)).toBe(500); // capped
  });
});

describe("quiz party: the reveal", () => {
  test("stats name the fastest correct answer, ranks report movement, and the guest's result survives a reload", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("quizparty-reveal@weddly.test");
    const { id, code, slides } = await liveQuiz(token, [mcq("Q1", 2), mcq("Q2", 3)]);
    const anna = await join(code, "Anna");
    const bence = await join(code, "Bence");
    const csilla = await join(code, "Csilla");

    // Lobby roster, in join order.
    const lobby = await guestState(code, anna.token);
    expect(lobby.data.lobbyPlayers.map((p) => p.name)).toEqual(["Anna", "Bence", "Csilla"]);

    // Q1: only Anna is right. Q2: only Csilla, so Csilla climbs past Bence.
    await host(token, id, "begin-slide", { slideId: "next" });
    await answer(code, anna.token, slides[0]!.id, 2);
    await answer(code, bence.token, slides[0]!.id, 0);
    await host(token, id, "reveal");

    await host(token, id, "begin-slide", { slideId: "next" });
    const before = await guestState(code, csilla.token);
    expect(before.data.myAnswer).toBeNull();
    expect(before.data.lobbyPlayers).toEqual([]);
    await answer(code, csilla.token, slides[1]!.id, 3);
    await answer(code, bence.token, slides[1]!.id, 0);
    await host(token, id, "reveal");

    const hostView = await req<QuizHostState>("GET", `/api/quizzes/${id}/host-state`, undefined, {
      token,
    });
    expect(hostView.data.revealStats).toMatchObject({
      answered: 2,
      correct: 1,
      fastest: { name: "Csilla" },
    });
    const byName = new Map(hostView.data.leaderboard.map((e) => [e.player.name, e]));
    expect(byName.get("Csilla")!.rankChange).toBeGreaterThan(0);
    expect(byName.get("Anna")!.rankChange).toBe(0);

    // A reloaded phone reads its own result from the server, not from memory.
    const mine = await guestState(code, csilla.token);
    expect(mine.data.myAnswer).toMatchObject({ correct: true, points: QUIZ_DEFAULT_POINTS });
    expect(mine.data.revealStats?.fastest?.name).toBe("Csilla");
    const missed = await guestState(code, anna.token);
    expect(missed.data.myAnswer).toBeNull();
  });
});
