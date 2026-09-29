import { estimatedPayout, type MarketPool, marketProbability } from "@shared/markets";
import {
  ArrowRight,
  ArrowUpDown,
  BarChart3,
  CakeSlice,
  Check,
  Clock3,
  Coins,
  Crown,
  Droplets,
  Flower2,
  Gamepad2,
  Heart,
  type LucideIcon,
  LockKeyhole,
  Music,
  PartyPopper,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Trophy,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Wordmark } from "../components/Wordmark";
import { usePublicPageMeta } from "../lib/seo";
import "./GamesPage.css";

type Answer = {
  label: string;
  shape: "triangle" | "diamond" | "circle" | "square";
};

type Question = {
  kicker: string;
  question: string;
  answers: Answer[];
  correct: number;
};

type MarketCategory = "ceremony" | "party" | "food";

type Side = "YES" | "NO";

type LastBet = { id: number; who: string; side: Side; stake: number };

type Market = {
  id: string;
  icon: LucideIcon;
  category: MarketCategory;
  question: string;
  closes: string;
  /** Pari-mutuel pool, priced the same way as the real game
   *  (`marketProbability` in shared/markets.ts). Seeded small on purpose so
   *  a single guest's bet visibly moves the line. */
  pool: MarketPool;
  /** The pool's opening probability — simulated guests lean toward it so
   *  the demo odds wander around a believable number instead of drifting
   *  to 0 or 100 while the page sits open. */
  anchor: number;
  /** Probability history, oldest first; the last value is always
   *  `marketProbability(pool)`. */
  history: number[];
  lastBet: LastBet | null;
};

const QUIZ_QUESTIONS: Question[] = [
  {
    kicker: "Round 1 · Their story",
    question: "Who said “I love you” first?",
    answers: [
      { label: "Emma", shape: "triangle" },
      { label: "Noah", shape: "diamond" },
      { label: "They said it together", shape: "circle" },
      { label: "Neither remembers", shape: "square" },
    ],
    correct: 1,
  },
  {
    kicker: "Round 2 · Firsts",
    question: "Where was their first proper date?",
    answers: [
      { label: "A tiny wine bar", shape: "triangle" },
      { label: "The cinema", shape: "diamond" },
      { label: "A rainy picnic", shape: "circle" },
      { label: "At a friend’s party", shape: "square" },
    ],
    correct: 2,
  },
  {
    kicker: "Round 3 · Be honest",
    question: "Who takes longer to get ready?",
    answers: [
      { label: "Emma, easily", shape: "triangle" },
      { label: "Noah, secretly", shape: "diamond" },
      { label: "It depends on brunch", shape: "circle" },
      { label: "The dog", shape: "square" },
    ],
    correct: 3,
  },
];

const INITIAL_MARKETS: Market[] = [
  {
    id: "tears",
    icon: Droplets,
    category: "ceremony",
    question: "Will the groom cry during the vows?",
    closes: "Before the vows",
    pool: { yes: 548, no: 192 },
    anchor: 74,
    history: [44, 47, 45, 52, 51, 58, 56, 63, 61, 67, 70, 74],
    lastBet: null,
  },
  {
    id: "bouquet",
    icon: Flower2,
    category: "party",
    question: "Will a single guest catch the bouquet?",
    closes: "At bouquet toss",
    pool: { yes: 218, no: 302 },
    anchor: 42,
    history: [51, 49, 47, 48, 44, 46, 45, 41, 39, 43, 40, 42],
    lastBet: null,
  },
  {
    id: "dance",
    icon: Music,
    category: "party",
    question: "Will the first dance last the full song?",
    closes: "Before first dance",
    pool: { yes: 281, no: 179 },
    anchor: 61,
    history: [39, 42, 46, 44, 49, 52, 55, 53, 57, 60, 58, 61],
    lastBet: null,
  },
  {
    id: "cake",
    icon: CakeSlice,
    category: "food",
    question: "Will there be a cake smash?",
    closes: "Before cake cutting",
    pool: { yes: 90, no: 230 },
    anchor: 28,
    history: [36, 37, 34, 35, 31, 29, 32, 30, 27, 29, 26, 28],
    lastBet: null,
  },
];

const MARKET_TABS: { id: MarketCategory | "all"; label: string }[] = [
  { id: "all", label: "Trending" },
  { id: "ceremony", label: "Ceremony" },
  { id: "party", label: "Party" },
  { id: "food", label: "Food & drinks" },
];

const HISTORY_CAP = 40;
const GUEST_BET_EVERY_MS = 2800;
const GUEST_NAMES = [
  "Anna",
  "Bence",
  "Chloé",
  "Dávid",
  "Eszter",
  "Finn",
  "Greta",
  "Hugo",
  "Lili",
  "Marco",
];
const GUEST_STAKES = [10, 15, 20, 25, 30, 40, 50, 75];

function volumeOf(market: Market): number {
  return market.pool.yes + market.pool.no;
}

function withBet(market: Market, bet: LastBet): Market {
  const pool = {
    yes: market.pool.yes + (bet.side === "YES" ? bet.stake : 0),
    no: market.pool.no + (bet.side === "NO" ? bet.stake : 0),
  };
  const history = [...market.history, marketProbability(pool)].slice(-HISTORY_CAP);
  return { ...market, pool, history, lastBet: bet };
}

const ANSWER_STYLES = [
  "games-answer-red",
  "games-answer-blue",
  "games-answer-yellow",
  "games-answer-green",
];

/** Polymarket-style probability line: auto-scaled to the history's own
 *  range (so a 3-point move is visible, not a flat line near 70%), with
 *  labelled gridlines, the dashed 50% mark when it's in range, and a
 *  pulsing dot at the latest price that re-fires on every new bet. The
 *  line is stretched with `preserveAspectRatio="none"`, so the dot and the
 *  labels are HTML laid over it — an SVG circle would render as an oval. */
function LiveChart({
  values,
  pulseKey,
  tall = false,
}: {
  values: number[];
  /** Changes on every bet so the end dot's pulse re-fires. */
  pulseKey: number;
  tall?: boolean;
}) {
  const gradientId = useId();
  const w = 300;
  const h = 100;
  const min = Math.min(...values);
  const max = Math.max(...values);
  let lo = Math.max(0, Math.floor((min - 5) / 10) * 10);
  let hi = Math.min(100, Math.ceil((max + 5) / 10) * 10);
  if (hi - lo < 20) {
    if (hi + 10 <= 100) hi += 10;
    if (hi - lo < 20) lo = Math.max(0, lo - 10);
  }
  const yOf = (v: number) => ((hi - v) / (hi - lo)) * h;
  const xOf = (i: number) => (values.length < 2 ? w : (i / (values.length - 1)) * w);
  const points = values.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(" ");
  const last = values[values.length - 1] ?? 50;
  const prev = values[values.length - 2] ?? last;
  const down = last < prev;
  const grid = [hi, Math.round((hi + lo) / 2), lo];

  return (
    <div className={`games-live-chart ${tall ? "is-tall" : ""}`}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Chance of yes over time, now ${last}%`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#2388ff" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#2388ff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {grid.map((g) => (
          <line
            key={g}
            x1="0"
            x2={w}
            y1={yOf(g)}
            y2={yOf(g)}
            stroke="#e3e8ef"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {lo < 50 && hi > 50 && (
          <line
            x1="0"
            x2={w}
            y1={yOf(50)}
            y2={yOf(50)}
            stroke="#94a0af"
            strokeWidth="1"
            strokeDasharray="3 4"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <polygon points={`0,${h} ${points} ${w},${h}`} fill={`url(#${gradientId})`} />
        <polyline
          points={points}
          fill="none"
          stroke="#2388ff"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {grid.map((g) => (
        <span key={g} className="games-live-chart-label" style={{ top: `${(yOf(g) / h) * 100}%` }}>
          {g}%
        </span>
      ))}
      <span
        key={pulseKey}
        className={`games-live-chart-dot ${down ? "is-down" : ""}`}
        style={{ top: `${(yOf(last) / h) * 100}%` }}
        aria-hidden="true"
      />
    </div>
  );
}

function Shape({ type }: { type: Answer["shape"] }) {
  if (type === "triangle") return <span className="games-shape games-shape-triangle" />;
  if (type === "diamond") return <span className="games-shape games-shape-diamond" />;
  if (type === "circle") return <span className="games-shape games-shape-circle" />;
  return <span className="games-shape games-shape-square" />;
}

function RegisterLink({ dark = false }: { dark?: boolean }) {
  return (
    <Link to="/signup" className={`games-register ${dark ? "games-register-dark" : ""}`}>
      Register <ArrowRight size={13} aria-hidden />
    </Link>
  );
}

export default function GamesPage() {
  usePublicPageMeta(
    "Wedding games for every guest · Wēddly",
    "Live wedding quizzes and playful prediction markets for the whole guest list. Preview what is coming to Wēddly Games.",
    "/games",
  );

  const [balance, setBalance] = useState(500);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [quizPoints, setQuizPoints] = useState(0);
  const [markets, setMarkets] = useState<Market[]>(INITIAL_MARKETS);
  const [activeMarketId, setActiveMarketId] = useState<string | null>(null);
  const [side, setSide] = useState<Side>("YES");
  const [stake, setStake] = useState(50);
  const [predictionCount, setPredictionCount] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useState<MarketCategory | "all">("all");
  const [sortBy, setSortBy] = useState<"volume" | "chance">("volume");
  const toastTimer = useRef<number | null>(null);
  const betSeq = useRef(0);
  const activeMarket = markets.find((m) => m.id === activeMarketId) ?? null;

  const question = QUIZ_QUESTIONS[questionIndex]!;
  const isCorrect = selectedAnswer === question.correct;
  const maxStake = Math.max(0, balance);
  const activeYes = activeMarket ? marketProbability(activeMarket.pool) : 50;
  const potentialReturn = activeMarket
    ? estimatedPayout(activeMarket.pool, side === "YES" ? "yes" : "no", stake)
    : 0;

  // Card order is decided when the viewer picks a tab or sort, not on every
  // bet — re-sorting live would slide a card out from under the cursor.
  const [order, setOrder] = useState<string[]>(() => INITIAL_MARKETS.map((m) => m.id));
  const marketsRef = useRef(markets);
  marketsRef.current = markets;
  useEffect(() => {
    const snapshot = marketsRef.current.filter((m) => tab === "all" || m.category === tab);
    snapshot.sort((a, b) =>
      sortBy === "volume"
        ? volumeOf(b) - volumeOf(a)
        : marketProbability(b.pool) - marketProbability(a.pool),
    );
    setOrder(snapshot.map((m) => m.id));
  }, [tab, sortBy]);
  const visibleMarkets = order
    .map((id) => markets.find((m) => m.id === id))
    .filter((m): m is Market => m !== undefined);

  const hotIds = useMemo(
    () =>
      new Set(
        [...markets]
          .sort((a, b) => volumeOf(b) - volumeOf(a))
          .slice(0, 2)
          .map((m) => m.id),
      ),
    [markets],
  );

  // The room keeps betting while you watch: every few seconds a simulated
  // guest backs one market, which moves its pool, price and chart exactly
  // like a real bet would. Paused while the tab is hidden so a background
  // tab doesn't come back to a wall of history.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      // Draw the bet outside the state updater so it stays pure (StrictMode
      // may run an updater twice).
      const targetId = INITIAL_MARKETS[Math.floor(Math.random() * INITIAL_MARKETS.length)]?.id;
      const anchor = INITIAL_MARKETS.find((m) => m.id === targetId)?.anchor ?? 50;
      betSeq.current += 1;
      const bet: LastBet = {
        id: betSeq.current,
        who: GUEST_NAMES[Math.floor(Math.random() * GUEST_NAMES.length)] ?? "A guest",
        side: Math.random() < 0.15 + 0.7 * (anchor / 100) ? "YES" : "NO",
        stake: GUEST_STAKES[Math.floor(Math.random() * GUEST_STAKES.length)] ?? 20,
      };
      setMarkets((current) => current.map((m) => (m.id === targetId ? withBet(m, bet) : m)));
    }, GUEST_BET_EVERY_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!activeMarketId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveMarketId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeMarketId]);

  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  function chooseAnswer(index: number) {
    if (selectedAnswer !== null) return;
    setSelectedAnswer(index);
    if (index === question.correct) {
      setBalance((current) => current + 50);
      setQuizPoints((current) => current + 50);
    }
  }

  function nextQuestion() {
    setQuestionIndex((current) => (current + 1) % QUIZ_QUESTIONS.length);
    setSelectedAnswer(null);
  }

  function openTrade(market: Market, nextSide: Side) {
    setActiveMarketId(market.id);
    setSide(nextSide);
    setStake(Math.min(50, balance));
  }

  function addStake(amount: number) {
    setStake((current) => Math.min(balance, current + amount));
  }

  function placePrediction() {
    if (!activeMarket || stake <= 0 || stake > balance) return;
    betSeq.current += 1;
    const bet: LastBet = { id: betSeq.current, who: "You", side, stake };
    const before = marketProbability(activeMarket.pool);
    const after = marketProbability(withBet(activeMarket, bet).pool);
    setMarkets((current) => current.map((m) => (m.id === activeMarket.id ? withBet(m, bet) : m)));
    setBalance((current) => current - stake);
    setPredictionCount((current) => current + 1);
    setToast(`${stake} pts on ${side} moved the odds ${before}% → ${after}%`);
    setActiveMarketId(null);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3600);
  }

  return (
    <div className="games-page min-h-screen bg-[#080b12] text-white">
      <header className="games-header">
        <div className="mx-auto flex h-[72px] max-w-[1440px] items-center gap-3 px-4 sm:px-7 lg:px-10">
          <Link to="/" className="games-logo" aria-label="Weddly home">
            <Wordmark size="md" className="text-[17px] tracking-[0.26em] sm:text-lg" />
          </Link>
          <span className="hidden h-5 w-px bg-white/15 sm:block" />
          <span className="hidden items-center gap-2 text-sm font-semibold text-white/70 sm:flex">
            <Gamepad2 size={16} aria-hidden /> Games
          </span>

          <nav
            className="ml-auto hidden items-center gap-6 text-sm font-medium text-white/60 md:flex"
            aria-label="Games"
          >
            <a href="#quiz" className="hover:text-white">
              Quiz
            </a>
            <a href="#markets" className="hover:text-white">
              Predictions
            </a>
            <a href="#how-it-works" className="hover:text-white">
              How it works
            </a>
          </nav>

          <div className="ml-auto flex items-center gap-2 md:ml-4">
            <div className="games-wallet" title="Your demo balance">
              <span className="games-wallet-coin">
                <Coins size={14} aria-hidden />
              </span>
              <strong>{balance}</strong>
              <span>PTS</span>
            </div>
            <RegisterLink dark />
          </div>
        </div>
      </header>

      <main>
        <section className="games-hero relative overflow-hidden px-4 pb-24 pt-20 sm:px-7 sm:pb-32 sm:pt-28 lg:px-10">
          <div className="games-orb games-orb-one" />
          <div className="games-orb games-orb-two" />
          <div className="games-confetti" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
          <div className="relative z-10 mx-auto max-w-[1240px] text-center">
            <div className="games-lab-pill mx-auto">
              <Sparkles size={14} aria-hidden /> Wēddly Games Lab · early preview
            </div>
            <h1 className="games-hero-title mx-auto mt-8 max-w-5xl">
              The reception just became <span>a sport.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-white/58 sm:text-lg">
              Break the ice, test who really knows the couple, and predict the night’s biggest
              moments. Every guest starts with <strong className="text-white">500 points.</strong>
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a href="#quiz" className="games-primary-button">
                Explore the games <ArrowRight size={18} aria-hidden />
              </a>
              <span className="flex items-center gap-2 text-sm text-white/40">
                <LockKeyhole size={14} aria-hidden /> No real money. Just bragging rights.
              </span>
            </div>
          </div>

          <div className="relative z-10 mx-auto mt-20 grid max-w-[1120px] gap-3 sm:grid-cols-3">
            {[
              { icon: Users, value: "Everyone", label: "plays from their phone" },
              { icon: Zap, value: "Live", label: "questions & market odds" },
              { icon: Trophy, value: "One", label: "ultimate wedding champion" },
            ].map(({ icon: Icon, value, label }) => (
              <div key={value} className="games-stat-card">
                <Icon size={18} aria-hidden />
                <div>
                  <strong>{value}</strong>
                  <span>{label}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section
          id="quiz"
          className="games-quiz-section scroll-mt-20 px-4 py-24 sm:px-7 sm:py-32 lg:px-10"
        >
          <div className="mx-auto max-w-[1240px]">
            <div className="mb-10 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="games-section-kicker text-[#bfa2ff]">01 · Live quiz</p>
                <h2 className="games-section-title mt-3">Who knows them best?</h2>
                <p className="mt-3 max-w-xl text-white/55">
                  Fast questions, louder answers, instant glory.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="games-live-pill">
                  <span /> Live preview
                </span>
                <span className="games-score-pill">+{quizPoints} pts earned</span>
              </div>
            </div>

            <div className="games-quiz-shell">
              <div className="games-quiz-topbar">
                <span className="games-pin">
                  <span>GAME PIN</span> 14 09 26
                </span>
                <span>
                  {questionIndex + 1} / {QUIZ_QUESTIONS.length}
                </span>
                <span className="flex items-center gap-2">
                  <Users size={15} aria-hidden /> 84 players
                </span>
              </div>
              <div className="games-question-wrap">
                <div className="games-timer" aria-label="18 seconds left">
                  <span>18</span>
                </div>
                <div className="text-center">
                  <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-[#6b21a8]">
                    {question.kicker}
                  </p>
                  <h3>{question.question}</h3>
                </div>
                <div className="games-place-chip">
                  <strong>6</strong>
                  <span>of 84</span>
                </div>
              </div>

              <div className="games-answers-grid">
                {question.answers.map((answer, index) => {
                  const chosen = selectedAnswer === index;
                  const correct = selectedAnswer !== null && question.correct === index;
                  const muted = selectedAnswer !== null && !chosen && !correct;
                  return (
                    <button
                      key={answer.label}
                      type="button"
                      disabled={selectedAnswer !== null}
                      onClick={() => chooseAnswer(index)}
                      className={`${ANSWER_STYLES[index]} ${chosen ? "is-chosen" : ""} ${correct ? "is-correct" : ""} ${muted ? "is-muted" : ""}`}
                    >
                      <Shape type={answer.shape} />
                      <span>{answer.label}</span>
                      {correct && (
                        <Check className="ml-auto" size={24} strokeWidth={3} aria-hidden />
                      )}
                      {chosen && !correct && (
                        <X className="ml-auto" size={24} strokeWidth={3} aria-hidden />
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="games-quiz-footer">
                <div>
                  {selectedAnswer === null ? (
                    <span>Pick an answer to play the preview</span>
                  ) : isCorrect ? (
                    <strong className="text-emerald-700">Correct! +50 points</strong>
                  ) : (
                    <strong className="text-rose-700">Not quite — the room knows.</strong>
                  )}
                </div>
                {selectedAnswer !== null && (
                  <button type="button" onClick={nextQuestion}>
                    {questionIndex === QUIZ_QUESTIONS.length - 1 ? "Play again" : "Next question"}{" "}
                    <ArrowRight size={16} aria-hidden />
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        <section
          id="markets"
          className="games-market-section scroll-mt-16 px-4 py-24 text-[#111827] sm:px-7 sm:py-32 lg:px-10"
        >
          <div className="mx-auto max-w-[1240px]">
            <div className="games-market-heading">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <p className="games-section-kicker whitespace-nowrap text-[#1769e0]">
                    02 · Prediction market
                  </p>
                  <RegisterLink />
                </div>
                <h2 className="games-section-title mt-3 text-[#111827]">Trade the night.</h2>
                <p className="mt-3 max-w-2xl text-[#64748b]">
                  Read the room. Back your instinct. Win points when the wedding unfolds your way.
                </p>
              </div>
              <div className="games-market-balance">
                <span>Available to predict</span>
                <strong>
                  <span className="games-blue-coin">W</span>
                  {balance.toLocaleString()} <small>PTS</small>
                </strong>
              </div>
            </div>

            <div className="games-market-toolbar">
              <div className="games-market-tabs" role="tablist" aria-label="Market categories">
                {MARKET_TABS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === item.id}
                    className={tab === item.id ? "active" : ""}
                    onClick={() => setTab(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="games-sort-button"
                onClick={() => setSortBy((current) => (current === "volume" ? "chance" : "volume"))}
              >
                {sortBy === "volume" ? "Most traded" : "Highest chance"}{" "}
                <ArrowUpDown size={14} aria-hidden />
              </button>
            </div>

            <div className="games-markets-grid">
              {visibleMarkets.map((market) => {
                const Icon = market.icon;
                const yes = marketProbability(market.pool);
                const opened = market.history[0] ?? yes;
                const delta = yes - opened;
                const moved = yes - (market.history[market.history.length - 2] ?? yes);
                return (
                  <article key={market.id} className="games-market-card">
                    <div className="games-market-meta">
                      <span className="games-market-icon" aria-hidden="true">
                        <Icon size={18} strokeWidth={1.75} />
                      </span>
                      <span className="games-market-status">
                        <span /> {hotIds.has(market.id) ? "Hot market" : "Open"}
                      </span>
                    </div>
                    <h3>{market.question}</h3>
                    <div className="games-probability-row">
                      <div>
                        <strong
                          key={market.lastBet?.id ?? 0}
                          className={
                            moved > 0 ? "games-flash-up" : moved < 0 ? "games-flash-down" : ""
                          }
                          aria-live="polite"
                        >
                          {yes}%
                        </strong>
                        <span>chance</span>
                        {delta !== 0 && (
                          <em className={delta > 0 ? "games-delta-up" : "games-delta-down"}>
                            {delta > 0 ? (
                              <TrendingUp size={12} aria-hidden />
                            ) : (
                              <TrendingDown size={12} aria-hidden />
                            )}
                            {delta > 0 ? "+" : ""}
                            {delta}
                          </em>
                        )}
                      </div>
                      <LiveChart values={market.history} pulseKey={market.lastBet?.id ?? 0} />
                    </div>
                    <div className="games-bet-ticker" aria-live="off">
                      {market.lastBet ? (
                        <span
                          key={market.lastBet.id}
                          className={market.lastBet.side === "YES" ? "is-yes" : "is-no"}
                        >
                          <strong>{market.lastBet.who}</strong> bet {market.lastBet.stake} pts on{" "}
                          <b>{market.lastBet.side}</b>
                        </span>
                      ) : (
                        <span className="is-idle">Waiting for the next bet…</span>
                      )}
                    </div>
                    <div className="games-market-actions">
                      <button type="button" onClick={() => openTrade(market, "YES")}>
                        Yes <strong>{yes}¢</strong>
                      </button>
                      <button type="button" onClick={() => openTrade(market, "NO")}>
                        No <strong>{100 - yes}¢</strong>
                      </button>
                    </div>
                    <div className="games-market-footer">
                      <span>
                        <BarChart3 size={13} aria-hidden /> {volumeOf(market).toLocaleString()} pts
                        traded
                      </span>
                      <span>
                        <Clock3 size={13} aria-hidden /> {market.closes}
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>

            {predictionCount > 0 && (
              <div className="games-position-note">
                <Check size={17} aria-hidden /> You have {predictionCount} open{" "}
                {predictionCount === 1 ? "prediction" : "predictions"} in this preview.
              </div>
            )}
          </div>
        </section>

        <section
          id="how-it-works"
          className="games-how-section px-4 py-24 sm:px-7 sm:py-32 lg:px-10"
        >
          <div className="mx-auto max-w-[1240px]">
            <div className="games-how-header">
              <p className="games-section-kicker text-[#f6bf54]">From “I do” to final score</p>
              <h2 className="games-section-title mt-3">One link. A room full of players.</h2>
            </div>
            <div className="games-steps-grid">
              {[
                {
                  number: "01",
                  icon: PartyPopper,
                  title: "Couple creates",
                  body: "Choose questions and moments guests can predict before the big day.",
                },
                {
                  number: "02",
                  icon: Coins,
                  title: "Guests get 500",
                  body: "Everyone joins by QR code. No app, no payment, no awkward setup.",
                },
                {
                  number: "03",
                  icon: Crown,
                  title: "Champion crowned",
                  body: "Points settle live and the leaderboard reveals the sharpest guest.",
                },
              ].map(({ number, icon: Icon, title, body }) => (
                <article key={number}>
                  <span className="games-step-number">{number}</span>
                  <div className="games-step-icon">
                    <Icon size={24} aria-hidden />
                  </div>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </article>
              ))}
            </div>

            <div className="games-coming-card">
              <div className="games-coming-art" aria-hidden="true">
                <span>W</span>
                <Heart size={32} fill="currentColor" />
                <span>500</span>
              </div>
              <div className="relative z-10">
                <RegisterLink dark />
                <h2>We’re still setting the table.</h2>
                <p>
                  Wēddly Games is an interactive concept preview. Scores, markets and bets on this
                  page are for play only and reset when you leave.
                </p>
              </div>
              <Link to="/" className="games-back-button">
                Back to Wēddly <ArrowRight size={17} aria-hidden />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="games-footer">
        <Wordmark size="sm" className="tracking-[0.25em]" />
        <p>Love is not a game. The reception can be.</p>
        <span>© {new Date().getFullYear()} Wēddly</span>
      </footer>

      {activeMarket && (
        <div
          className="games-trade-overlay"
          role="presentation"
          onMouseDown={() => setActiveMarketId(null)}
        >
          <section
            className="games-trade-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="trade-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="games-trade-panel-head">
              <div>
                <span className="games-market-icon" aria-hidden="true">
                  <activeMarket.icon size={18} strokeWidth={1.75} />
                </span>
                <strong>Make a prediction</strong>
              </div>
              <button
                type="button"
                onClick={() => setActiveMarketId(null)}
                aria-label="Close prediction panel"
              >
                <X size={19} />
              </button>
            </div>
            <h2 id="trade-title">{activeMarket.question}</h2>
            <div className="games-trade-chart">
              <div>
                <strong>{activeYes}%</strong> chance · live
              </div>
              <LiveChart
                values={activeMarket.history}
                pulseKey={activeMarket.lastBet?.id ?? 0}
                tall
              />
            </div>
            <div className="games-side-toggle">
              <button
                type="button"
                className={side === "YES" ? "active" : ""}
                onClick={() => setSide("YES")}
              >
                Yes · {activeYes}¢
              </button>
              <button
                type="button"
                className={side === "NO" ? "active" : ""}
                onClick={() => setSide("NO")}
              >
                No · {100 - activeYes}¢
              </button>
            </div>
            <div className="games-stake-label">
              <span>Points to play</span>
              <span>Balance: {balance} pts</span>
            </div>
            <div className="games-stake-value">
              <Coins size={23} aria-hidden />
              <strong>{stake}</strong>
              <span>PTS</span>
            </div>
            <div className="games-stake-chips">
              {[25, 50, 100].map((amount) => (
                <button
                  key={amount}
                  type="button"
                  disabled={stake >= balance}
                  onClick={() => addStake(amount)}
                >
                  +{amount}
                </button>
              ))}
              <button type="button" onClick={() => setStake(maxStake)}>
                Max
              </button>
              <button type="button" onClick={() => setStake(0)} disabled={stake === 0}>
                Clear
              </button>
            </div>
            <div className="games-return-row">
              <span>Estimated return if {side} wins</span>
              <strong>{potentialReturn} pts</strong>
            </div>
            <button
              type="button"
              className="games-place-button"
              disabled={stake <= 0 || stake > balance}
              onClick={placePrediction}
            >
              Place {side} prediction
            </button>
            <p className="games-trade-disclaimer">
              <LockKeyhole size={12} aria-hidden /> Preview points only. No money or prizes.
            </p>
          </section>
        </div>
      )}

      {toast && (
        <div className="games-toast" role="status">
          <Check size={17} aria-hidden />
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}
