// Path traversal (A01: Broken Access Control / A03).
import { readFileSync } from "node:fs";
import { join } from "node:path";

const UPLOAD_DIR = "/var/app/uploads";

// `name` like "../../etc/passwd" escapes UPLOAD_DIR — no normalization/check.
export function readUpload(name: string): string {
  return readFileSync(join(UPLOAD_DIR, name), "utf8");
}
