// src/cli/wizard.ts
// `agent-wallet init` — the one-shot, no-questions setup for a new trading bot.
//
// It generates all three wallets (Polygon, Hyperliquid, Solana), points your
// agent at the MCP, and drops a plain-English WALLETS file telling you which
// addresses to fund. There are NO prompts and NO password: the keys are written
// as plaintext env vars into mcp.json, which the MCP reads directly. Everything
// for one bot lands in a single folder, so making another bot is just `init`
// again in a different folder.
import {
  generateEvmKey,
  generateSolanaKey,
  solanaSecretKeyBase58,
} from "../keygen.js";
import { CHAINS, type Chain } from "../keystore/format.js";
import {
  writeConfig,
  writeMcpJson,
  appendIgnore,
  renderWalletsFile,
  writeWalletsFile,
  resolveMcpBinPath,
  mcpBinPathIsPlaceholder,
  MCP_BIN_REL,
  type StarlingConfig,
  type SecretKeys,
  type WalletEntry,
  type Network,
} from "../config.js";

const out = (m = "") => process.stdout.write(m + "\n");

// Effectively "no cap" — the MCP still enforces it, but we don't make a
// non-technical user invent a number. Override with --daily-cap <usd>.
const DEFAULT_DAILY_CAP_USD = 1_000_000;

interface Flags {
  network: Network;
  dailyCap: number;
  outDir: string;
  force: boolean;
}

function parseFlags(argv: string[]): Flags {
  const get = (k: string): string | undefined => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (k: string) => argv.includes(k);
  const capRaw = get("--daily-cap");
  return {
    // Mainnet is the default. --testnet is the only escape hatch.
    network: has("--testnet") ? "testnet" : "mainnet",
    dailyCap: capRaw ? Number(capRaw) : DEFAULT_DAILY_CAP_USD,
    outDir: get("--out") ?? process.cwd(),
    force: has("--force"),
  };
}

export async function runInit(argv: string[]): Promise<void> {
  const f = parseFlags(argv);
  const venues = CHAINS as readonly Chain[]; // always all three

  out(`Creating a new Starling bot — network: ${f.network}${f.network === "mainnet" ? "  (REAL FUNDS)" : ""}`);
  out("");

  // Generate one fresh wallet per venue. EVM keys (Polygon/Hyperliquid) are
  // secp256k1; Solana is ed25519. The Hyperliquid wallet is its OWN account —
  // fund it and it trades, no separate approval step.
  const keys: SecretKeys = {};
  const wallets: Partial<Record<Chain, string>> = {};
  const entries: WalletEntry[] = [];

  for (const chain of venues) {
    if (chain === "solana") {
      const k = generateSolanaKey();
      const secret = solanaSecretKeyBase58(k.seed); // base58 64-byte (Phantom format)
      k.seed.fill(0);
      keys.solana = secret;
      wallets.solana = k.pubkeyBase58;
      entries.push({ chain, address: k.pubkeyBase58, secretMaterial: secret });
      out(`  solana       ${k.pubkeyBase58}`);
    } else {
      const k = generateEvmKey();
      const secret = `0x${Buffer.from(k.secret).toString("hex")}`;
      k.secret.fill(0);
      keys[chain] = secret;
      wallets[chain] = k.address;
      entries.push({ chain, address: k.address, secretMaterial: secret });
      out(`  ${chain.padEnd(12)} ${k.address}`);
    }
  }

  const cfg: StarlingConfig = {
    version: 1,
    network: f.network,
    signerBackend: "local",
    unlockMode: "env",
    guardrails: {
      perTradeMaxUsd: 0,
      dailyNotionalCapUsd: f.dailyCap,
      allowlist: [],
      killSwitch: false,
    },
    wallets,
  };

  // Everything for this bot goes in one folder (outDir): mcp.json (keys live
  // here), config.json, WALLETS.txt, and the ignore guards.
  const mcpPath = await writeMcpJson(cfg, keys, f.outDir);
  const cfgPath = await writeConfig(cfg, f.outDir);
  const walletsPath = await writeWalletsFile(renderWalletsFile(entries, cfg), f.outDir);
  await appendIgnore(".gitignore", f.outDir);
  await appendIgnore(".dockerignore", f.outDir);

  out("");
  out(`  mcp.json     -> ${mcpPath}   (point your agent here)`);
  out(`  WALLETS.txt  -> ${walletsPath}   (fund these addresses + back up the keys)`);
  out(`  config.json  -> ${cfgPath}`);
  out("");

  const mcpBin = resolveMcpBinPath(f.outDir);
  if (mcpBinPathIsPlaceholder(mcpBin)) {
    out(
      "  ! Couldn't auto-find your Starling-MCP clone, so mcp.json has a placeholder path.\n" +
        "    Clone github.com/thedopetoad/Starling-MCP next to this folder and run\n" +
        `    \`npm install\` in it, then re-run init — or set STARLING_MCP_DIR to the clone\n` +
        `    root. (Manual fix: edit mcp.json's "args" to YOUR clone's ${MCP_BIN_REL}.)`,
    );
    out("");
  } else {
    out(`  MCP auto-detected at: ${mcpBin}`);
    out("");
  }

  out("Done. Next:");
  out("  1. Open WALLETS.txt and send funds to the 3 addresses to give your bot money.");
  out("  2. Back up WALLETS.txt somewhere safe and offline (it has the private keys).");
  out("  3. Point your agent host at mcp.json and start trading.");
}
