// src/util.ts — tiny helpers shared across the CLI.
import os from "node:os";

/** Free system memory in bytes (used to decide the argon2 KDF floor). */
export function freeMem(): number {
  return os.freemem();
}
