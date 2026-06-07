// SQL injection via string concatenation (A03: Injection).
import { config } from "./config";

interface Db {
  query(sql: string): Promise<unknown[]>;
}

// User-controlled `email` is concatenated straight into the SQL string.
export async function findUserByEmail(db: Db, email: string) {
  const sql = "SELECT * FROM users WHERE email = '" + email + "'";
  return db.query(sql);
}

// Worse: ORDER BY + LIMIT taken from raw request input, also concatenated.
export async function listUsers(db: Db, sort: string, limit: string) {
  return db.query(`SELECT id, email FROM users ORDER BY ${sort} LIMIT ${limit}`);
}

// Connection string logs the hardcoded password in plaintext.
export function connString(host: string) {
  return `postgres://admin:${config.dbPassword}@${host}:5432/app`;
}
