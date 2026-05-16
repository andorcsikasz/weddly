// Argon2id benchmark: measures Bun.password.hash + verify across a handful
// of cost settings so we have data before touching backend/src/auth/password.ts.
//
// Usage:
//   bun run scripts/bench/argon2.ts
// Env:
//   ITERS=20  — samples per setting (more = tighter p95)

const ITERS = Number(process.env.ITERS ?? 20);
const PASSWORD = "supersafe123-bench";

// Settings to compare. Bun's argon2id default (when only `algorithm` is
// given) is m=65536 KB / t=2 — listing it explicitly so the table reads as
// a level apples-to-apples comparison rather than "default vs others".
//
// OWASP's 2024 password storage cheat-sheet recommends m≥19456, t=2 (lossy
// devices) or m≥9216, t=4 (memory-constrained) as the minimum acceptable
// Argon2id parameters. Higher m is the better hardening axis; reducing m
// below 19456 should be a deliberate capacity decision, not a default.
const SETTINGS: Array<{
  label: string;
  options: Parameters<typeof Bun.password.hash>[1];
}> = [
  { label: "current default (m=65536, t=2)", options: { algorithm: "argon2id" } },
  {
    label: "OWASP min (m=19456, t=2)",
    options: { algorithm: "argon2id", memoryCost: 19456, timeCost: 2 },
  },
  {
    label: "balanced (m=32768, t=2)",
    options: { algorithm: "argon2id", memoryCost: 32768, timeCost: 2 },
  },
  {
    label: "hardened (m=65536, t=3)",
    options: { algorithm: "argon2id", memoryCost: 65536, timeCost: 3 },
  },
];

interface Sample {
  hashMs: number;
  verifyMs: number;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

async function runOne(options: Parameters<typeof Bun.password.hash>[1]): Promise<Sample[]> {
  const samples: Sample[] = [];
  // Warm-up: the first call after a cold start tends to be noticeably slow
  // (JIT + memory allocator). Drop it from the measured set.
  const warmHash = await Bun.password.hash(PASSWORD, options);
  await Bun.password.verify(PASSWORD, warmHash);

  for (let i = 0; i < ITERS; i++) {
    const t0 = performance.now();
    const hash = await Bun.password.hash(PASSWORD, options);
    const t1 = performance.now();
    await Bun.password.verify(PASSWORD, hash);
    const t2 = performance.now();
    samples.push({ hashMs: t1 - t0, verifyMs: t2 - t1 });
  }
  return samples;
}

function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(2)}s`;
  return `${n.toFixed(0)}ms`;
}

async function main() {
  console.log(`# Argon2id benchmark (${ITERS} iterations per setting)`);
  console.log("");
  console.log("Bun:", Bun.version);
  console.log("Platform:", process.platform, process.arch);
  console.log("CPU:", navigator?.hardwareConcurrency ?? "?", "logical cores");
  console.log("");

  console.log("| setting | hash p50 | hash p95 | verify p50 | verify p95 | mem |");
  console.log("|---|---:|---:|---:|---:|---:|");
  for (const cfg of SETTINGS) {
    process.stdout.write(`  running ${cfg.label}...\r`);
    const samples = await runOne(cfg.options);
    const hashLats = samples.map((s) => s.hashMs);
    const verifyLats = samples.map((s) => s.verifyMs);
    const mem =
      typeof cfg.options === "object" && cfg.options && "memoryCost" in cfg.options
        ? `${cfg.options.memoryCost} KB`
        : "default";
    console.log(
      `| ${cfg.label} | ${fmt(percentile(hashLats, 50))} | ${fmt(percentile(hashLats, 95))} | ${fmt(
        percentile(verifyLats, 50),
      )} | ${fmt(percentile(verifyLats, 95))} | ${mem} |`,
    );
  }
  console.log("");
  console.log("Notes:");
  console.log("- OWASP 2024 minimum: m ≥ 19456 KB, t ≥ 2 for Argon2id.");
  console.log(
    "- Lowering memoryCost reduces cost-of-attack for an adversary with a GPU farm; only do it if capacity is the binding constraint.",
  );
  console.log(
    "- Verify cost dominates the steady-state path (login on every visit > one-off registration).",
  );
}

await main();
