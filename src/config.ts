// src/config.ts
// Integration files the streamlined `init` writes for a bot: the Starling
// config, a .env holding the signing keys, the MCP host config (mcp.json), the
// ignore-file guards, and a plain-English WALLETS file. In the env-key model the
// bot's PRIVATE KEYS live in a plaintext .env (which mcp.json loads via
// `node --env-file`) and are mirrored in WALLETS.txt as an offline backup — both
// are gitignored, never commit them. Everything for one bot lands in a single
// folder so a second bot can't clobber the first.
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Chain } from "./keystore/format.js";

export type UnlockMode = "keychain" | "env" | "tpm" | "kms" | "file";
export type SignerBackend = "local" | "turnkey";
export type Network = "testnet" | "mainnet";

export interface StarlingConfig {
  version: 1;
  network: Network;
  signerBackend: SignerBackend;
  unlockMode: UnlockMode;
  guardrails: {
    perTradeMaxUsd: number;
    dailyNotionalCapUsd: number;
    allowlist: string[];
    killSwitch: boolean;
  };
  wallets: Partial<Record<Chain, string>>; // public addresses only
}

/** Write the (non-secret) config.json next to the bot's mcp.json. */
export async function writeConfig(cfg: StarlingConfig, dir = process.cwd()): Promise<string> {
  const dest = path.join(dir, "config.json");
  await fs.writeFile(dest, JSON.stringify(cfg, null, 2), "utf8");
  return dest;
}

/** Absolute path to the local Starling-MCP clone's compiled entrypoint.
 * Resolution order (first hit wins — no hand-editing needed in the normal case):
 *   1. STARLING_MCP_PATH env (point it straight at dist/bin/starling-mcp.js)
 *   2. STARLING_MCP_DIR env (the clone root; we append the bin path)
 *   3. AUTODETECT: look for a `Starling-MCP` clone sitting next to this repo or
 *      next to the bot folder (the usual "both repos cloned side by side" layout).
 *   4. a clearly-marked placeholder (only if nothing above is found).
 * The MCP runs locally — clone Starling-MCP, `npm install` (its prepare script
 * builds dist/), then the agent host launches the compiled bin. */
export const MCP_BIN_REL = "dist/bin/starling-mcp.js";
const MCP_PATH_PLACEHOLDER = `/ABSOLUTE/PATH/TO/Starling-MCP/${MCP_BIN_REL}`;

/** Candidate clone roots to probe, in order, for an auto-detected Starling-MCP. */
function mcpProbeDirs(outDir: string): string[] {
  // This file is dist/config.js at runtime; the repo root is two levels up.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, ".."); // dist/ -> repo root
  const bases = [outDir, process.cwd(), repoRoot];
  const dirs: string[] = [];
  for (const b of bases) {
    dirs.push(path.join(b, "Starling-MCP")); // a clone INSIDE the folder
    dirs.push(path.resolve(b, "..", "Starling-MCP")); // a SIBLING clone
  }
  return dirs;
}

export function resolveMcpBinPath(outDir: string = process.cwd()): string {
  const direct = process.env.STARLING_MCP_PATH?.trim();
  if (direct) return direct;
  const dir = process.env.STARLING_MCP_DIR?.trim();
  if (dir) return path.join(dir, MCP_BIN_REL);
  for (const root of mcpProbeDirs(outDir)) {
    const candidate = path.join(root, MCP_BIN_REL);
    if (existsSync(candidate)) return candidate;
  }
  return MCP_PATH_PLACEHOLDER;
}

/** True when the mcp.json still holds the un-edited placeholder path. */
export function mcpBinPathIsPlaceholder(p: string): boolean {
  return p === MCP_PATH_PLACEHOLDER;
}

/** Plaintext per-chain private keys, in the formats the MCP's env source parses:
 *  EVM (polygon/hyperliquid) as 0x-hex, Solana as base58 (32- or 64-byte). */
export type SecretKeys = Partial<Record<Chain, string>>;

/** Absolute path to the bot's .env (the file that holds the signing keys). */
export function envFilePath(outDir = process.cwd()): string {
  return path.resolve(outDir, ".env");
}

/** The .env the bot's keys live in. The MCP's `env` key source reads these; the
 * generated mcp.json loads this file via `node --env-file`, and you can run the
 * MCP (or your own bot) directly the same way:
 *   node --env-file=.env <Starling-MCP>/dist/bin/starling-mcp.js
 * Plain KEY=value lines, no `export` — the Node --env-file / dotenv format. EVM
 * keys are 0x-hex and Solana is base58, so no value needs quoting. */
export function buildEnvFile(cfg: StarlingConfig, keys: SecretKeys): string {
  const lines = [
    "# Starling bot — PRIVATE KEYS. Gitignored; never commit, paste, or share this file.",
    "# Loaded by mcp.json via `node --env-file=.env`; the MCP's env key source reads these.",
    "",
    "STARLING_KEY_SOURCE=env",
    `STARLING_NETWORK=${cfg.network}`,
  ];
  if (keys.polygon) lines.push(`STARLING_PK_POLYGON=${keys.polygon}`);
  if (keys.hyperliquid) lines.push(`STARLING_PK_HYPERLIQUID=${keys.hyperliquid}`);
  if (keys.solana) lines.push(`STARLING_PK_SOLANA=${keys.solana}`);
  return lines.join("\n") + "\n";
}

/** Write the bot's .env (signing keys) at 0600. */
export async function writeEnvFile(content: string, dir = process.cwd()): Promise<string> {
  const dest = path.join(dir, ".env");
  await fs.writeFile(dest, content, { encoding: "utf8", mode: 0o600 });
  return dest;
}

/** The exact mcp.json the MCP host (Claude/Cursor/your agent) consumes.
 * The bot's signing keys are NOT inlined here — they live in the sibling .env,
 * which we load with `node --env-file=<abs>/.env` so the MCP's `env` key source
 * picks them up. `args` is auto-pointed at your local Starling-MCP clone; the
 * (non-secret) env block keeps the key source + network self-documenting. */
export function buildMcpJson(cfg: StarlingConfig, outDir = process.cwd()): string {
  return JSON.stringify(
    {
      mcpServers: {
        starling: {
          command: "node",
          // load the bot's keys from .env, then run your local Starling-MCP clone
          args: [`--env-file=${envFilePath(outDir)}`, resolveMcpBinPath(outDir)],
          env: {
            STARLING_KEY_SOURCE: "env",
            STARLING_NETWORK: cfg.network,
          },
        },
      },
    },
    null,
    2,
  );
}

export async function writeMcpJson(cfg: StarlingConfig, dir = process.cwd()): Promise<string> {
  const dest = path.join(dir, "mcp.json");
  // No secrets in mcp.json now (keys live in .env), but it carries machine-local
  // paths — keep it gitignored and 0600 like the rest of the bot folder.
  await fs.writeFile(dest, buildMcpJson(cfg, dir), { encoding: "utf8", mode: 0o600 });
  return dest;
}

const IGNORE_BLOCK = `
# Starling agent wallet — NEVER commit these, they contain PRIVATE KEYS
mcp.json
WALLETS.txt
config.json
/.starling/
.starling/
*.keystore.json
RECOVERY-SHEET.txt
.env
.env.*
!.env.example
`;

/** Idempotently append the ignore block to a file in `dir` (creates it if absent). */
export async function appendIgnore(file: ".gitignore" | ".dockerignore", dir = process.cwd()): Promise<void> {
  const dest = path.join(dir, file);
  let existing = "";
  try {
    existing = await fs.readFile(dest, "utf8");
  } catch {
    /* new file */
  }
  if (existing.includes("Starling agent wallet")) return; // already guarded
  await fs.writeFile(dest, existing + IGNORE_BLOCK, "utf8");
}

export interface WalletEntry {
  chain: Chain;
  /** the public address — this is what you FUND. */
  address: string;
  /** the private key in a standard portable format (0x-hex / base58). BACK UP. */
  secretMaterial: string;
}

const VENUE_LABEL: Record<Chain, string> = {
  polygon: "Polygon (Polymarket)",
  hyperliquid: "Hyperliquid",
  solana: "Solana (Jupiter)",
};

/**
 * A plain-English wallets file written next to mcp.json. The TOP half (addresses)
 * is what you fund; the BOTTOM half (private keys) is your offline backup. Same
 * keys are already in the bot's .env so the agent can trade — this file is for YOU.
 */
export function renderWalletsFile(entries: WalletEntry[], cfg: StarlingConfig): string {
  const lines = [
    "================ YOUR BOT'S WALLETS ================",
    "",
    `Network: ${cfg.network}`,
    "",
    "Your bot has 3 wallets. To give it money to trade, send funds to these",
    "addresses (this is safe to share — they only RECEIVE):",
    "",
  ];
  for (const e of entries) {
    lines.push(`  ${VENUE_LABEL[e.chain].padEnd(22)} ${e.address}`);
  }
  lines.push(
    "",
    "------------------- PRIVATE KEYS (SECRET) -------------------",
    "",
    "BACK THESE UP somewhere safe and OFFLINE (a password manager, or written",
    "on paper). Anyone who gets a key controls that wallet's money. Never email",
    "them, paste them online, or commit them to git.",
    "",
  );
  for (const e of entries) {
    lines.push(`  ${VENUE_LABEL[e.chain].padEnd(22)} ${e.secretMaterial}`);
  }
  lines.push(
    "",
    "These same keys are stored in the bot's .env (which mcp.json loads) so your",
    "agent trades automatically — you do NOT need to paste them anywhere. To retire",
    "this bot, just move its funds out and delete its folder.",
    "===================================================",
  );
  return lines.join("\n");
}

/** Write the WALLETS file next to mcp.json, locked down at 0600. */
export async function writeWalletsFile(content: string, dir = process.cwd()): Promise<string> {
  const dest = path.join(dir, "WALLETS.txt");
  await fs.writeFile(dest, content, { encoding: "utf8", mode: 0o600 });
  return dest;
}
