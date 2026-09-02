import {
  ArrowRight,
  BarChart3,
  Check,
  ChevronDown,
  Clock3,
  Coins,
  Crown,
  Gamepad2,
  Heart,
  LockKeyhole,
  PartyPopper,
  Sparkles,
  Trophy,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
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

type Market = {
  id: string;
  icon: string;
  question: string;
  yes: number;
  volume: string;
  closes: string;
  trend: number[];
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

const MARKETS: Market[] = [
  {
    id: "tears",
    icon: "🥹",
    question: "Will the groom cry during the vows?",
    yes: 74,
    volume: "3,240 pts",
    closes: "Before the vows",
    trend: [44, 47, 45, 52, 51, 58, 56, 63, 61, 67, 70, 74],
  },
  {
    id: "bouquet",
    icon: "💐",
    question: "Will a single guest catch the bouquet?",
    yes: 42,
    volume: "2,180 pts",
    closes: "At bouquet toss",
    trend: [51, 49, 47, 48, 44, 46, 45, 41, 39, 43, 40, 42],
  },
  {
    id: "dance",
    icon: "🪩",
    question: "Will the first dance last the full song?",
    yes: 61,
    volume: "1,870 pts",
    closes: "Before first dance",
    trend: [39, 42, 46, 44, 49, 52, 55, 53, 57, 60, 58, 61],
  },
  {
    id: "cake",
    icon: "🎂",
    question: "Will there be a cake smash?",
    yes: 28,
    volume: "980 pts",
    closes: "Before cake cutting",
    trend: [36, 37, 34, 35, 31, 29, 32, 30, 27, 29, 26, 28],
  },
];

const ANSWER_STYLES = [
  "games-answer-red",
  "games-answer-blue",
  "games-answer-yellow",
  "games-answer-green",
];

function MiniChart({ values }: { values: number[] }) {
  const points = values
    .map((value, index) => `${(index / (values.length - 1)) * 180},${62 - value * 0.56}`)
    .join(" ");

  return (
    <svg viewBox="0 0 180 64" className="h-14 w-full" role="img" aria-label="Probability trend">
      <defs>
        <linearGradient id="games-chart-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#2388ff" stopOpacity="0.24" />
          <stop offset="100%" stopColor="#2388ff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,64 ${points} 180,64`} fill="url(#games-chart-fill)" />
      <polyline
        points={points}
        fill="none"
        stroke="#2388ff"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Shape({ type }: { type: Answer["shape"] }) {
  if (type === "triangle") return <span className="games-shape games-shape-triangle" />;
  if (type === "diamond") return <span className="games-shape games-shape-diamond" />;
  if (type === "circle") return <span className="games-shape games-shape-circle" />;
  return <span className="games-shape games-shape-square" />;
}

function DevBadge({ dark = false }: { dark?: boolean }) {
  return (
    <span className={`games-dev-badge ${dark ? "games-dev-badge-dark" : ""}`}>
      <span className="games-dev-dot" />
      Under development
    </span>
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
  const [activeMarket, setActiveMarket] = useState<Market | null>(null);
  const [side, setSide] = useState<"YES" | "NO">("YES");
  const [stake, setStake] = useState(50);
  const [predictionCount, setPredictionCount] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  const question = QUIZ_QUESTIONS[questionIndex]!;
  const isCorrect = selectedAnswer === question.correct;
  const maxStake = Math.max(0, balance);
  const potentialReturn = useMemo(() => {
    if (!activeMarket) return 0;
    const probability = side === "YES" ? activeMarket.yes : 100 - activeMarket.yes;
    return probability > 0 ? Math.round(stake * (100 / probability)) : 0;
  }, [activeMarket, side, stake]);

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

  function openTrade(market: Market, nextSide: "YES" | "NO") {
    setActiveMarket(market);
    setSide(nextSide);
    setStake(Math.min(50, balance));
  }

  function placePrediction() {
    if (!activeMarket || stake <= 0 || stake > balance) return;
    setBalance((current) => current - stake);
    setPredictionCount((current) => current + 1);
    setToast(`${stake} points placed on ${side} · ${activeMarket.question}`);
    setActiveMarket(null);
    window.setTimeout(() => setToast(null), 3600);
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
            <DevBadge dark />
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
                    Next question <ArrowRight size={16} aria-hidden />
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
                  <DevBadge />
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
              <div className="games-market-tabs">
                <button type="button" className="active">
                  Trending
                </button>
                <button type="button">Ceremony</button>
                <button type="button">Party</button>
                <button type="button">Food & drinks</button>
              </div>
              <button type="button" className="games-sort-button">
                Most traded <ChevronDown size={15} aria-hidden />
              </button>
            </div>

            <div className="games-markets-grid">
              {MARKETS.map((market, marketIndex) => (
                <article key={market.id} className="games-market-card">
                  <div className="games-market-meta">
                    <span className="games-market-icon" aria-hidden="true">
                      {market.icon}
                    </span>
                    <span className="games-market-status">
                      <span /> {marketIndex < 2 ? "Hot market" : "Open"}
                    </span>
                  </div>
                  <h3>{market.question}</h3>
                  <div className="games-probability-row">
                    <div>
                      <strong>{market.yes}%</strong>
                      <span>chance</span>
                    </div>
                    <div className="games-chart">
                      <MiniChart values={market.trend} />
                    </div>
                  </div>
                  <div className="games-market-actions">
                    <button type="button" onClick={() => openTrade(market, "YES")}>
                      Yes <strong>{market.yes}¢</strong>
                    </button>
                    <button type="button" onClick={() => openTrade(market, "NO")}>
                      No <strong>{100 - market.yes}¢</strong>
                    </button>
                  </div>
                  <div className="games-market-footer">
                    <span>
                      <BarChart3 size={13} aria-hidden /> {market.volume} traded
                    </span>
                    <span>
                      <Clock3 size={13} aria-hidden /> {market.closes}
                    </span>
                  </div>
                </article>
              ))}
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
                <DevBadge dark />
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
          onMouseDown={() => setActiveMarket(null)}
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
                <span className="games-market-icon">{activeMarket.icon}</span>
                <strong>Make a prediction</strong>
              </div>
              <button
                type="button"
                onClick={() => setActiveMarket(null)}
                aria-label="Close prediction panel"
              >
                <X size={19} />
              </button>
            </div>
            <h2 id="trade-title">{activeMarket.question}</h2>
            <div className="games-side-toggle">
              <button
                type="button"
                className={side === "YES" ? "active" : ""}
                onClick={() => setSide("YES")}
              >
                Yes · {activeMarket.yes}¢
              </button>
              <button
                type="button"
                className={side === "NO" ? "active" : ""}
                onClick={() => setSide("NO")}
              >
                No · {100 - activeMarket.yes}¢
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
                  disabled={amount > balance}
                  onClick={() => setStake(amount)}
                >
                  +{amount}
                </button>
              ))}
              <button type="button" onClick={() => setStake(maxStake)}>
                Max
              </button>
            </div>
            <div className="games-return-row">
              <span>Potential return</span>
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
