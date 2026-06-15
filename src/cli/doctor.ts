// src/cli/doctor.ts
// `agent-wallet doctor` — preflight + hygiene checks. Prints a PASS/WARN/FAIL
// report and exits non-zero if anything is FAIL.
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { starlingDir, keystoreDir } from "../keystore/store.js";
import { CHAINS } from "../keystore/format.js";

type Level = "PASS" | "WARN" | "FAIL";
const isWin = process.platform === "win32";

function line(level: Level, msg: string) {
  const tag = level === "PASS" ? "✓" : level === "WARN" ? "!" : "✗";
  process.stdout.write(`  ${tag} ${msg}\n`);
}

export async function run(): Promise<void> {
  let fail = 0;
  process.stdout.write("agent-wallet doctor\n");

  // Node version
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 20) line("PASS", `Node ${process.versions.node}`);
  else {
    line("FAIL", `Node ${process.versions.node} — need ≥20`);
    fail++;
  }

  // CSPRNG sanity
  try {
    const a = randomBytes(32);
    const b = randomBytes(32);
    if (Buffer.compare(a, b) !== 0) line("PASS", "crypto.randomBytes is platform CSPRNG-backed");
    else {
      line("FAIL", "randomBytes returned identical buffers");
      fail++;
    }
  } catch (e) {
    line("FAIL", `randomBytes unavailable: ${(e as Error).message}`);
    fail++;
  }

  // ~/.starling perms
  try {
    const st = await fs.stat(starlingDir());
    if (!isWin && (st.mode & 0o077) !== 0) {
      line("FAIL", `${starlingDir()} is group/world-accessible (chmod 700)`);
      fail++;
    } else line("PASS", `${starlingDir()} present`);
  } catch {
    line("WARN", `${starlingDir()} not found — run 'agent-wallet init'`);
  }

  // keystore file perms
  for (const chain of CHAINS) {
    const p = path.join(keystoreDir(), `${chain}.keystore.json`);
    try {
      const st = await fs.stat(p);
      if (!isWin && (st.mode & 0o077) !== 0) {
        line("FAIL", `${chain}.keystore.json is group/world-readable (chmod 600)`);
        fail++;
      } else {
        line("PASS", `${chain}.keystore.json ${isWin ? "present" : `mode ${(st.mode & 0o777).toString(8)}`}`);
      }
    } catch {
      /* not all venues configured; fine */
    }
  }

  // NEXT_PUBLIC_ key/secret leak check (the Next.js footgun)
  const leaky = Object.keys(process.env).filter((k) =>
    /^NEXT_PUBLIC_.*(KEY|SECRET|MNEMONIC|PRIV|PASSPHRASE)/i.test(k),
  );
  if (leaky.length) {
    line("FAIL", `NEXT_PUBLIC_ vars look like secrets (inlined into client JS!): ${leaky.join(", ")}`);
    fail++;
  } else line("PASS", "no NEXT_PUBLIC_*KEY/SECRET/PASSPHRASE in env");

  // mainnet + plaintext passphrase file co-location
  if ((process.env.STARLING_NETWORK ?? "testnet") === "mainnet" && process.env.STARLING_PASSPHRASE_FILE) {
    const pf = path.resolve(process.env.STARLING_PASSPHRASE_FILE);
    if (pf.startsWith(path.resolve(starlingDir()))) {
      line("FAIL", "plaintext passphrase file sits inside ~/.starling on mainnet — co-located plaintext defeats at-rest encryption");
      fail++;
    } else {
      line("WARN", "mainnet using a plaintext passphrase file — prefer --unlock tpm|kms");
    }
  }

  process.stdout.write(fail ? `\n${fail} FAIL — fix before arming real money.\n` : "\nAll checks passed.\n");
  if (fail) process.exitCode = 1;
}
