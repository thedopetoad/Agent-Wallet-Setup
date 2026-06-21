// src/cli/doctor.ts
// `agent-wallet doctor` — quick environment + hygiene checks. Prints a
// PASS/WARN/FAIL report and exits non-zero if anything is FAIL.
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

type Level = "PASS" | "WARN" | "FAIL";
const isWin = process.platform === "win32";

function line(level: Level, msg: string) {
  const tag = level === "PASS" ? "✓" : level === "WARN" ? "!" : "✗";
  process.stdout.write(`  ${tag} ${msg}\n`);
}

export async function run(): Promise<void> {
  let fail = 0;
  process.stdout.write("agent-wallet doctor\n");

  // Node version (MCP hosts don't bundle Node — the user must have it on PATH).
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 20) line("PASS", `Node ${process.versions.node}`);
  else {
    line("FAIL", `Node ${process.versions.node} — need ≥20`);
    fail++;
  }

  // CSPRNG sanity — key generation depends on this.
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

  // A bot folder in the cwd? Check mcp.json holds keys and is gitignored.
  const mcpPath = path.join(process.cwd(), "mcp.json");
  try {
    const raw = await fs.readFile(mcpPath, "utf8");
    const hasKeys = /STARLING_PK_/.test(raw);
    if (hasKeys) line("PASS", "mcp.json present with bot keys");
    else line("WARN", "mcp.json present but has no STARLING_PK_* keys — re-run 'agent-wallet init'");

    // mcp.json/WALLETS.txt carry plaintext keys — make sure git won't grab them.
    let ignored = false;
    try {
      const gi = await fs.readFile(path.join(process.cwd(), ".gitignore"), "utf8");
      ignored = /(^|\n)\s*mcp\.json\s*(\n|$)/.test(gi);
    } catch {
      /* no .gitignore */
    }
    if (ignored) line("PASS", "mcp.json is gitignored");
    else {
      line("FAIL", "mcp.json holds private keys but is NOT gitignored — add it to .gitignore");
      fail++;
    }

    if (!isWin) {
      const st = await fs.stat(mcpPath);
      if ((st.mode & 0o077) !== 0) {
        line("WARN", "mcp.json is group/world-readable — chmod 600 it (it has private keys)");
      } else line("PASS", "mcp.json is owner-only (mode 600)");
    }
  } catch {
    line("WARN", "no mcp.json in this folder — run 'agent-wallet init' to create a bot here");
  }

  // NEXT_PUBLIC_ key/secret leak check (the Next.js footgun — inlined into client JS).
  const leaky = Object.keys(process.env).filter((k) =>
    /^NEXT_PUBLIC_.*(KEY|SECRET|MNEMONIC|PRIV|PASSPHRASE)/i.test(k),
  );
  if (leaky.length) {
    line("FAIL", `NEXT_PUBLIC_ vars look like secrets (inlined into client JS!): ${leaky.join(", ")}`);
    fail++;
  } else line("PASS", "no NEXT_PUBLIC_*KEY/SECRET/PASSPHRASE in env");

  process.stdout.write(fail ? `\n${fail} FAIL — fix before funding the bot.\n` : "\nAll checks passed.\n");
  if (fail) process.exitCode = 1;
}
