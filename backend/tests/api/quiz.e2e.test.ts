// Live wedding quiz game — couple builder + host control (authenticated) and
// guest join/play (public, no login). Major-change rule: new endpoints, new
// schema, and a phase state machine all ship together, covered here.

import "../setup";

import { describe, expect, test } from "bun:test";
import type { QuizDetail, QuizHostState, QuizPublicState } from "@shared/quiz";
import { db } from "../../src/db";
import { bootstrapCouple, req, wipeAll } from "../helpers";

const PLAYER_TOKEN_HEADER = "X-Quiz-Player-Token";

async function setup(email: string) {
  wipeAll();
  const { token, coupleId } = await bootstrapCouple(email);
  return { token, coupleId };
}

async function createQuizWithMcq(token: string) {
  const create = await req<{ quiz: QuizDetail }>(
    "POST",
    "/api/quizzes",
    { title: "Test Quiz" },
    { token },
  );
  expect(create.status).toBe(201);
  const quizId = create.data.quiz.id;

  const addMcq = await req<{ quiz: QuizDetail }>(
    "POST",
    `/api/quizzes/${quizId}/slides`,
    {
      kind: "mcq",
      prompt: "Who proposed?",
      timeLimitS: 20,
      config: { options: ["Amy", "Ben", "Cara", "Dev"], correctIndex: 1 },
    },
    { token },
  );
  expect(addMcq.status).toBe(201);
  const slideId = addMcq.data.quiz.slides[0]!.id;
  return { quizId, slideId };
}

function backdatePhaseStart(quizId: number, msAgo: number) {
  const row = db.prepare("SELECT phase_started_at FROM quizzes WHERE id = ?").get(quizId) as {
    phase_started_at: number;
  };
  db.prepare("UPDATE quizzes SET phase_started_at = ? WHERE id = ?").run(
    row.phase_started_at - msAgo,
    quizId,
  );
}

describe("quiz builder", () => {
  test("a couple can add every slide kind, reorder, edit and delete", async () => {
    const { token } = await setup("quizbuilder@weddly.test");
    const create = await req<{ quiz: QuizDetail }>(
      "POST",
      "/api/quizzes",
      { title: "Our Wedding Quiz" },
      { token },
    );
    expect(create.status).toBe(201);
    const quizId = create.data.quiz.id;

    const kinds: Array<{ kind: string; body: Record<string, unknown> }> = [
      {
        kind: "mcq",
        body: { prompt: "Q1", config: { options: ["A", "B", "C", "D"], correctIndex: 0 } },
      },
      {
        kind: "binary",
        body: { prompt: "Q2", config: { options: ["Yes", "No"], correctIndex: 1 } },
      },
      {
        kind: "number",
        body: { prompt: "Q3", config: { min: 0, max: 200, step: 1, correctValue: 120 } },
      },
      {
        kind: "heatmap",
        body: {
          prompt: "Q4",
          config: {
            xLabel: ["Calm", "Sobbing"],
            yLabel: ["Short", "Long"],
            target: { x: 0.5, y: 0.5 },
          },
        },
      },
      { kind: "section", body: { prompt: "Round 2" } },
      { kind: "story", body: { prompt: "Once upon a time…" } },
    ];

    let last: { quiz: QuizDetail } | undefined;
    for (const { kind, body } of kinds) {
      const r = await req<{ quiz: QuizDetail }>(
        "POST",
        `/api/quizzes/${quizId}/slides`,
        { kind, ...body },
        { token },
      );
      expect(r.status).toBe(201);
      last = r.data;
    }
    expect(last!.quiz.slides).toHaveLength(6);
    expect(last!.quiz.slides.map((s) => s.kind)).toEqual([
      "mcq",
      "binary",
      "number",
      "heatmap",
      "section",
      "story",
    ]);

    // Reorder: move the last slide (story) up one, it should swap with section.
    const storySlideId = last!.quiz.slides[5]!.id;
    const moved = await req<{ quiz: QuizDetail }>(
      "POST",
      `/api/quizzes/${quizId}/slides/${storySlideId}/move`,
      { direction: "up" },
      { token },
    );
    expect(moved.status).toBe(200);
    expect(moved.data.quiz.slides[4]!.kind).toBe("story");
    expect(moved.data.quiz.slides[5]!.kind).toBe("section");

    // Edit the mcq slide's prompt.
    const mcqSlideId = moved.data.quiz.slides[0]!.id;
    const updated = await req<{ quiz: QuizDetail }>(
      "PATCH",
      `/api/quizzes/${quizId}/slides/${mcqSlideId}`,
      { prompt: "Updated question" },
      { token },
    );
    expect(updated.status).toBe(200);
    expect(updated.data.quiz.slides[0]!.prompt).toBe("Updated question");

    // Delete a slide.
    const deleted = await req<{ quiz: QuizDetail }>(
      "DELETE",
      `/api/quizzes/${quizId}/slides/${mcqSlideId}`,
      undefined,
      { token },
    );
    expect(deleted.status).toBe(200);
    expect(deleted.data.quiz.slides).toHaveLength(5);
  });

  test("slides are locked once the quiz goes live", async () => {
    const { token } = await setup("quizlock@weddly.test");
    const { quizId, slideId } = await createQuizWithMcq(token);

    const start = await req<QuizHostState>(
      "POST",
      `/api/quizzes/${quizId}/host/start`,
      {},
      { token },
    );
    expect(start.status).toBe(200);
    expect(start.data.quiz.status).toBe("live");

    const editAttempt = await req(
      "PATCH",
      `/api/quizzes/${quizId}/slides/${slideId}`,
      { prompt: "Nope" },
      { token },
    );
    expect(editAttempt.status).toBe(400);
    expect((editAttempt.data as { detail?: { code?: string } }).detail?.code).toBe("quiz_live");
  });
});

describe("quiz host + guest round trip", () => {
  test("join by name+avatar, answer, reveal, scoring and leaderboard order", async () => {
    const { token } = await setup("quizhost@weddly.test");
    const { quizId, slideId } = await createQuizWithMcq(token);

    await req("POST", `/api/quizzes/${quizId}/host/start`, {}, { token });
    const hostState = await req<QuizHostState>(
      "GET",
      `/api/quizzes/${quizId}/host-state`,
      undefined,
      { token },
    );
    const joinCode = hostState.data.quiz.joinCode;

    // Two guests join before the round starts.
    const joinA = await req<{ player: { id: number }; token: string; state: QuizPublicState }>(
      "POST",
      `/api/play/${joinCode}/join`,
      { name: "Alice", avatar: "🦄" },
    );
    expect(joinA.status).toBe(200);
    const joinB = await req<{ player: { id: number }; token: string; state: QuizPublicState }>(
      "POST",
      `/api/play/${joinCode}/join`,
      { name: "Bob", avatar: "🐝" },
    );
    expect(joinB.status).toBe(200);

    const begin = await req<QuizHostState>(
      "POST",
      `/api/quizzes/${quizId}/host/begin-slide`,
      { slideId: "next" },
      { token },
    );
    expect(begin.status).toBe(200);
    expect(begin.data.phase).toBe("active");
    expect(begin.data.currentSlide?.id).toBe(slideId);

    // Alice answers correctly, right away (near-max speed bonus).
    const answerA = await req<{ correct: boolean | null; points: number; myTotal: number }>(
      "POST",
      `/api/play/${joinCode}/answer`,
      { slideId, value: { kind: "mcq", optionIndex: 1 } },
      { headers: { [PLAYER_TOKEN_HEADER]: joinA.data.token } },
    );
    expect(answerA.status).toBe(200);
    expect(answerA.data.correct).toBe(true);
    expect(answerA.data.points).toBeGreaterThan(900);

    // Backdate the shared phase clock so Bob's answer reads as slower —
    // this is what makes the speed part of the score verifiable without a
    // real 15-second sleep in the test.
    backdatePhaseStart(quizId, 15_000);

    // Bob answers correctly too, but slower — fewer points for the same
    // right answer.
    const answerB = await req<{ correct: boolean | null; points: number; myTotal: number }>(
      "POST",
      `/api/play/${joinCode}/answer`,
      { slideId, value: { kind: "mcq", optionIndex: 1 } },
      { headers: { [PLAYER_TOKEN_HEADER]: joinB.data.token } },
    );
    expect(answerB.status).toBe(200);
    expect(answerB.data.correct).toBe(true);
    expect(answerB.data.points).toBeLessThan(answerA.data.points);

    // A duplicate answer from the same player is rejected.
    const dupe = await req(
      "POST",
      `/api/play/${joinCode}/answer`,
      { slideId, value: { kind: "mcq", optionIndex: 0 } },
      { headers: { [PLAYER_TOKEN_HEADER]: joinA.data.token } },
    );
    expect(dupe.status).toBe(409);

    // Host reveals — the leaderboard now ranks Alice above Bob.
    const reveal = await req<QuizHostState>(
      "POST",
      `/api/quizzes/${quizId}/host/reveal`,
      {},
      { token },
    );
    expect(reveal.status).toBe(200);
    expect(reveal.data.phase).toBe("reveal");
    expect(reveal.data.leaderboard[0]!.player.name).toBe("Alice");
    expect(reveal.data.leaderboard[1]!.player.name).toBe("Bob");
    expect(reveal.data.leaderboard[0]!.player.score).toBeGreaterThan(
      reveal.data.leaderboard[1]!.player.score,
    );
    expect(reveal.data.currentSlideAnswers).toHaveLength(2);

    // The guest's own screen shows the same reveal + rank.
    const guestState = await req<QuizPublicState>("GET", `/api/play/${joinCode}/state`, undefined, {
      headers: { [PLAYER_TOKEN_HEADER]: joinA.data.token },
    });
    expect(guestState.data.phase).toBe("reveal");
    expect(guestState.data.myRank).toBe(1);
    expect(guestState.data.currentSlide?.config).toMatchObject({ correctIndex: 1 });
  });

  test("an answer submitted after the time limit is rejected", async () => {
    const { token } = await setup("quiztimeout@weddly.test");
    const { quizId, slideId } = await createQuizWithMcq(token);
    await req("POST", `/api/quizzes/${quizId}/host/start`, {}, { token });
    const hostState = await req<QuizHostState>(
      "GET",
      `/api/quizzes/${quizId}/host-state`,
      undefined,
      { token },
    );
    const joinCode = hostState.data.quiz.joinCode;

    const join = await req<{ token: string }>("POST", `/api/play/${joinCode}/join`, {
      name: "Cara",
      avatar: "🎩",
    });
    await req("POST", `/api/quizzes/${quizId}/host/begin-slide`, { slideId: "next" }, { token });

    // The slide has a 20s window — push the clock 25s into the past.
    backdatePhaseStart(quizId, 25_000);

    const lateAnswer = await req(
      "POST",
      `/api/play/${joinCode}/answer`,
      { slideId, value: { kind: "mcq", optionIndex: 1 } },
      { headers: { [PLAYER_TOKEN_HEADER]: join.data.token } },
    );
    expect(lateAnswer.status).toBe(400);
    expect((lateAnswer.data as { detail?: { code?: string } }).detail?.code).toBe("answers_closed");
  });

  test("a guest reconnecting with their stored token keeps the same player and score", async () => {
    const { token } = await setup("quizreconnect@weddly.test");
    const { quizId, slideId } = await createQuizWithMcq(token);
    await req("POST", `/api/quizzes/${quizId}/host/start`, {}, { token });
    const hostState = await req<QuizHostState>(
      "GET",
      `/api/quizzes/${quizId}/host-state`,
      undefined,
      { token },
    );
    const joinCode = hostState.data.quiz.joinCode;

    const firstJoin = await req<{ player: { id: number }; token: string }>(
      "POST",
      `/api/play/${joinCode}/join`,
      { name: "Dev", avatar: "🎭" },
    );
    await req("POST", `/api/quizzes/${quizId}/host/begin-slide`, { slideId: "next" }, { token });
    await req(
      "POST",
      `/api/play/${joinCode}/answer`,
      { slideId, value: { kind: "mcq", optionIndex: 1 } },
      { headers: { [PLAYER_TOKEN_HEADER]: firstJoin.data.token } },
    );

    // Simulate a phone refresh: re-join with the SAME stored token.
    const rejoin = await req<{ player: { id: number }; token: string; state: QuizPublicState }>(
      "POST",
      `/api/play/${joinCode}/join`,
      { name: "Dev", avatar: "🎭" },
      { headers: { [PLAYER_TOKEN_HEADER]: firstJoin.data.token } },
    );
    expect(rejoin.status).toBe(200);
    expect(rejoin.data.player.id).toBe(firstJoin.data.player.id);
    expect(rejoin.data.token).toBe(firstJoin.data.token);
    expect(rejoin.data.state.myScore).toBeGreaterThan(0);

    const playersAfter = (
      db.prepare("SELECT COUNT(*) AS c FROM quiz_players WHERE quiz_id = ?").get(quizId) as {
        c: number;
      }
    ).c;
    expect(playersAfter).toBe(1);
  });

  test("resetting a live quiz clears players/answers and rotates the join code", async () => {
    const { token } = await setup("quizreset@weddly.test");
    const { quizId, slideId } = await createQuizWithMcq(token);
    await req("POST", `/api/quizzes/${quizId}/host/start`, {}, { token });
    const before = await req<QuizHostState>("GET", `/api/quizzes/${quizId}/host-state`, undefined, {
      token,
    });
    const oldCode = before.data.quiz.joinCode;

    const join = await req<{ token: string }>("POST", `/api/play/${oldCode}/join`, {
      name: "Eve",
      avatar: "🍰",
    });
    await req("POST", `/api/quizzes/${quizId}/host/begin-slide`, { slideId: "next" }, { token });
    await req(
      "POST",
      `/api/play/${oldCode}/answer`,
      { slideId, value: { kind: "mcq", optionIndex: 1 } },
      { headers: { [PLAYER_TOKEN_HEADER]: join.data.token } },
    );

    const reset = await req<{ quiz: QuizDetail }>(
      "POST",
      `/api/quizzes/${quizId}/host/reset`,
      {},
      { token },
    );
    expect(reset.status).toBe(200);
    expect(reset.data.quiz.status).toBe("draft");
    expect(reset.data.quiz.joinCode).not.toBe(oldCode);
    expect(reset.data.quiz.playerCount).toBe(0);

    const oldCodeLookup = await req("GET", `/api/play/${oldCode}`);
    expect(oldCodeLookup.status).toBe(404);

    const answersLeft = (
      db
        .prepare(
          "SELECT COUNT(*) AS c FROM quiz_answers WHERE slide_id IN (SELECT id FROM quiz_slides WHERE quiz_id = ?)",
        )
        .get(quizId) as { c: number }
    ).c;
    expect(answersLeft).toBe(0);
  });

  test("the public join endpoint rate-limits repeated requests from one IP", async () => {
    const { token } = await setup("quizratelimit@weddly.test");
    const { quizId } = await createQuizWithMcq(token);
    await req("POST", `/api/quizzes/${quizId}/host/start`, {}, { token });
    const hostState = await req<QuizHostState>(
      "GET",
      `/api/quizzes/${quizId}/host-state`,
      undefined,
      { token },
    );
    const joinCode = hostState.data.quiz.joinCode;

    const clientIp = "203.0.113.55";
    let sawRateLimit = false;
    for (let i = 0; i < 25; i++) {
      const r = await req(
        "POST",
        `/api/play/${joinCode}/join`,
        { name: `Guest ${i}`, avatar: "🐶" },
        { clientIp },
      );
      if (r.status === 429) {
        sawRateLimit = true;
        break;
      }
    }
    expect(sawRateLimit).toBe(true);
  });
});
