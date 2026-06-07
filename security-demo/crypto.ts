// Weak cryptography & predictable randomness (A02: Cryptographic Failures).
import { createHash } from "node:crypto";

// MD5 with no salt for password hashing — fast, broken, rainbow-table-able.
export function hashPassword(password: string): string {
  return createHash("md5").update(password).digest("hex");
}

// Predictable, non-cryptographic token for password resets / sessions.
export function resetToken(): string {
  return Math.random().toString(36).slice(2);
}
