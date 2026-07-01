import { Database } from "bun:sqlite";

const DB_PATH = process.env.DB_PATH ?? "./data/weddly.db";
const email = "planner@test.weddly";
const password = "123456789";

const db = new Database(DB_PATH);
const now = Date.now();
const hash = await Bun.password.hash(password, { algorithm: "argon2id" });

const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as
  | { id: number }
  | undefined;

if (existing) {
  db.prepare(
    "UPDATE users SET password_hash = ?, status = 'active', verified_email = 1, user_type = 'planner', password_set = 1, updated_at = ? WHERE id = ?",
  ).run(hash, now, existing.id);
  console.log(`Updated existing planner account id=${existing.id} (${email})`);
} else {
  const res = db
    .prepare(
      `INSERT INTO users (email, password_hash, full_name, status, role, verified_email, password_set, user_type, created_at, updated_at)
       VALUES (?, ?, ?, 'active', 'owner', 1, 1, 'planner', ?, ?)`,
    )
    .run(email, hash, "Test Planner", now, now);
  console.log(`Created planner account id=${res.lastInsertRowid} (${email})`);
}
