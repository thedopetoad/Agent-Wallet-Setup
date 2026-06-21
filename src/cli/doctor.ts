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
  // mcp.json launches the MCP with `node --env-file=.env`, which needs Node ≥20.6.
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major > 20 || (major === 20 && minor >= 6)) line("PASS", `Node ${process.versions.node}`);
  else {
    line("FAIL", `Node ${process.versions.node} — need ≥20.6 (for --env-file)`);
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

  // A bot folder in the cwd? The keys live in .env now (mcp.json loads it via
  // --env-file). Check the .env holds keys and is gitignored, and that mcp.json
  // points at it.
  const envPath = path.join(process.cwd(), ".env");
  const mcpPath = path.join(process.cwd(), "mcp.json");
  let envExists = false;
  try {
    const raw = await fs.readFile(envPath, "utf8");
    envExists = true;
    if (/STARLING_PK_/.test(raw)) line("PASS", ".env present with bot keys");
    else line("WARN", ".env present but has no STARLING_PK_* keys — re-run 'agent-wallet init'");

    // .env carries plaintext keys — make sure git won't grab it.
    let ignored = false;
    try {
      const gi = await fs.readFile(path.join(process.cwd(), ".gitignore"), "utf8");
      ignored = /(^|\n)\s*\.env\s*(\n|$)/.test(gi);
    } catch {
      /* no .gitignore */
    }
    if (ignored) line("PASS", ".env is gitignored");
    else {
      line("FAIL", ".env holds private keys but is NOT gitignored — add it to .gitignore");
      fail++;
    }

    if (!isWin) {
      const st = await fs.stat(envPath);
      if ((st.mode & 0o077) !== 0) {
        line("WARN", ".env is group/world-readable — chmod 600 it (it has private keys)");
      } else line("PASS", ".env is owner-only (mode 600)");
    }
  } catch {
    line("WARN", "no .env in this folder — run 'agent-wallet init' to create a bot here");
  }

  // mcp.json should be present next to .env and load it via --env-file.
  if (envExists) {
    try {
      const raw = await fs.readFile(mcpPath, "utf8");
      if (/--env-file/.test(raw)) line("PASS", "mcp.json loads .env via --env-file");
      else line("WARN", "mcp.json doesn't reference --env-file — re-run 'agent-wallet init'");
    } catch {
      line("WARN", "no mcp.json next to .env — re-run 'agent-wallet init'");
    }
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
