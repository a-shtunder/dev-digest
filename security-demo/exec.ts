// OS command injection (A03: Injection).
import { exec, execSync } from "node:child_process";

// User-supplied `host` flows into a shell command unsanitized.
export function pingHost(host: string, cb: (out: string) => void) {
  exec(`ping -c 1 ${host}`, (_err, stdout) => cb(stdout));
}

// Even worse: synchronous shell with interpolated filename.
export function gzip(filename: string): Buffer {
  return execSync(`gzip -c ${filename}`);
}
