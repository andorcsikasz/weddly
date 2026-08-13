import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const FORMAT = "weddly-sqlite-backup-v1";

type BackupEnvelope = {
  format: typeof FORMAT;
  key_id: string;
  algorithm: "aes-256-gcm";
  nonce: string;
  auth_tag: string;
  plaintext_sha256: string;
  created_at: string;
};

function keys(rawKeyring: string): Array<{ id: string; key: Buffer }> {
  return rawKeyring
    .split(",")
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf(":");
      return {
        id: entry.slice(0, separator).trim(),
        key: Buffer.from(entry.slice(separator + 1).trim(), "hex"),
      };
    });
}

export function encryptBackupBytes(
  plaintext: Uint8Array,
  rawKeyring: string,
  createdAtMs: number,
): Uint8Array {
  const active = keys(rawKeyring)[0];
  if (!active || active.key.byteLength !== 32) throw new Error("No valid off-site backup key");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", active.key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const envelope: BackupEnvelope = {
    format: FORMAT,
    key_id: active.id,
    algorithm: "aes-256-gcm",
    nonce: nonce.toString("base64"),
    auth_tag: cipher.getAuthTag().toString("base64"),
    plaintext_sha256: createHash("sha256").update(plaintext).digest("hex"),
    created_at: new Date(createdAtMs).toISOString(),
  };
  return Buffer.concat([Buffer.from(`${JSON.stringify(envelope)}\n`, "utf8"), ciphertext]);
}

export function decryptBackupBytes(encrypted: Uint8Array, rawKeyring: string): Uint8Array {
  const bytes = Buffer.from(encrypted);
  const newline = bytes.indexOf(10);
  if (newline <= 0) throw new Error("Invalid backup envelope");
  const envelope = JSON.parse(bytes.subarray(0, newline).toString("utf8")) as BackupEnvelope;
  if (envelope.format !== FORMAT || envelope.algorithm !== "aes-256-gcm") {
    throw new Error("Unsupported backup format");
  }
  const selected = keys(rawKeyring).find((candidate) => candidate.id === envelope.key_id);
  if (!selected || selected.key.byteLength !== 32)
    throw new Error("Backup decryption key unavailable");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    selected.key,
    Buffer.from(envelope.nonce, "base64"),
  );
  decipher.setAuthTag(Buffer.from(envelope.auth_tag, "base64"));
  const plaintext = Buffer.concat([decipher.update(bytes.subarray(newline + 1)), decipher.final()]);
  const checksum = createHash("sha256").update(plaintext).digest("hex");
  if (checksum !== envelope.plaintext_sha256) throw new Error("Backup checksum mismatch");
  return plaintext;
}
