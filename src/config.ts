// src/config.ts
// Non-secret integration files the wizard writes around the keystore: the
// Starling config, the MCP host config (mcp.json), ignore-file guards, and the
// offline recovery sheet. NONE of these ever contain key material or the
// passphrase.
import { promises as fs } from "node:fs";
import path from "node:path";
import { starlingDir, keystoreDir } from "./keystore/store.js";
import type { Chain } from "./keystore/format.js";

export type UnlockMode = "keychain" | "env" | "tpm" | "kms" | "file";
export type SignerBackend = "local" | "turnkey";
export type Network = "testnet" | "mainnet";

export interface StarlingConfig {
  version: 1;
  network: Network;
  signerBackend: SignerBackend;
  unlockMode: UnlockMode;
  /** per-venue sweep address profits return to (agent never holds this key). */
  treasury: Partial<Record<Chain, string>>;
  guardrails: {
    perTradeMaxUsd: number;
    dailyNotionalCapUsd: number;
    allowlist: string[];
    killSwitch: boolean;
  };
  wallets: Partial<Record<Chain, string>>; // public addresses only
}

export async function writeConfig(cfg: StarlingConfig): Promise<string> {
  const dest = path.join(starlingDir(), "config.json");
  await fs.writeFile(dest, JSON.stringify(cfg, null, 2), "utf8");
  return dest;
}

/** The exact mcp.json the MCP host (Claude/Cursor/your agent) consumes.
 * Runs the MCP straight from GitHub (no clone, no npm publish needed). To use a
 * local clone instead, swap to: command "node", args ["<path>/dist/bin/starling-mcp.js"]. */
export function buildMcpJson(cfg: StarlingConfig): string {
  return JSON.stringify(
    {
      mcpServers: {
        starling: {
          command: "npx",
          args: ["-y", "github:thedopetoad/Starling-MCP"],
          env: {
            // signing keys come from the encrypted keystore this tool wrote
            STARLING_KEY_SOURCE: "keystore",
            STARLING_UNLOCK_MODE: cfg.unlockMode,
            STARLING_NETWORK: cfg.network,
            // analytics-only; NEVER on the signing path. Replace before use.
            STARLING_KEY: "sk_live_REPLACE_ME_analytics_only",
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
  await fs.writeFile(dest, buildMcpJson(cfg), "utf8");
  return dest;
}

const IGNORE_BLOCK = `
# Starling agent wallet — NEVER commit keys, configs, or passphrases
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

export interface RecoveryEntry {
  chain: Chain;
  address: string;
  /** standard-format export material (hex private key / base58 secret). */
  secretMaterial: string;
}

/**
 * The recovery sheet is rendered to a FILE the user is told to move offline and
 * shred — never to stdout/scrollback. It carries the portable break-glass
 * material so recovery never depends on Starling existing.
 */
export function renderRecoverySheet(entries: RecoveryEntry[], cfg: StarlingConfig): string {
  const lines = [
    "================ STARLING AGENT WALLET — RECOVERY SHEET ================",
    "",
    "!! MOVE THIS FILE OFFLINE AND SHRED IT. Anyone with this can sign trades.",
    "",
    "THREAT MODEL (read this):",
    "  On an always-on server, anything that can run code as your user can",
    "  sign trades. The encrypted keystore stops a stolen backup/disk, NOT a",
    "  live breach. Your REAL protection is that these are thin, trade-not-",
    "  withdraw (Hyperliquid), expiring wallets — keep the float small and the",
    "  master / treasury keys OFF this box.",
    "",
    `Network: ${cfg.network}    Signer: ${cfg.signerBackend}    Unlock: ${cfg.unlockMode}`,
    "",
    "PER-VENUE KEYS (standard portable formats):",
  ];
  for (const e of entries) {
    lines.push(`  • ${e.chain.padEnd(11)} ${e.address}`);
    lines.push(`      secret: ${e.secretMaterial}`);
    const sweep = cfg.treasury[e.chain];
    if (sweep) lines.push(`      sweeps to treasury: ${sweep}`);
  }
  lines.push(
    "",
    "KEYSTORE FILES (encrypted; need your passphrase):",
    `  ${keystoreDir()}`,
    "",
    "REVOKE / ROTATE:",
    "  agent-wallet rotate --venue hyperliquid    # fresh agent key, same stable name",
    "  agent-wallet revoke --venue hyperliquid    # deregister the HL agent",
    "",
    "NOTE: the keystore format is 'Starling Keystore v1' (argon2id + XChaCha20-",
    "Poly1305) — NOT interoperable with MetaMask/geth. Use `agent-wallet export`",
    "for a standard wallet file.",
    "=======================================================================",
  );
  return lines.join("\n");
}

export async function writeRecoverySheet(content: string): Promise<string> {
  const dest = path.join(starlingDir(), "RECOVERY-SHEET.txt");
  await fs.writeFile(dest, content, { encoding: "utf8", mode: 0o600 });
  return dest;
}
