// src/cli/wizard.ts
// `agent-wallet init` — generate keys, de-risk per venue, encrypt to the local
// keystore, and write the integration files. Supports an interactive mode
// (prompts) and a --non-interactive mode (flags + STARLING_PASSPHRASE env) so it
// can run in CI / the cross-repo interop test without a TTY.
import prompts from "prompts";
import { randomUUID } from "node:crypto";
import {
  generateEvmKey,
  generateSolanaKey,
  solanaSecretKeyBase58,
} from "../keygen.js";
import { encryptKeystore } from "../keystore/crypto.js";
import { writeKeystore, keystoreExists } from "../keystore/store.js";
import { CHAINS, type Chain } from "../keystore/format.js";
import {
  writeConfig,
  writeMcpJson,
  appendIgnore,
  renderRecoverySheet,
  writeRecoverySheet,
  type StarlingConfig,
  type RecoveryEntry,
  type Network,
  type UnlockMode,
} from "../config.js";
import { freeMem } from "../util.js";

const out = (m = "") => process.stdout.write(m + "\n");

interface Flags {
  nonInteractive: boolean;
  network: Network;
  venues: Chain[];
  treasury?: string;
  treasuryEvm?: string;
  treasurySol?: string;
  dailyCap?: number;
  unlock: UnlockMode;
  force: boolean;
  outDir: string;
}

function parseFlags(argv: string[]): Flags {
  const get = (k: string): string | undefined => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (k: string) => argv.includes(k);
  const venuesRaw = get("--venues");
  const venues = (venuesRaw ? venuesRaw.split(",") : CHAINS).filter((v): v is Chain =>
    (CHAINS as readonly string[]).includes(v),
  );
  return {
    nonInteractive: has("--non-interactive") || has("--yes"),
    network: has("--mainnet") ? "mainnet" : "testnet",
    venues,
    treasury: get("--treasury"),
    treasuryEvm: get("--treasury-evm") ?? get("--treasury"),
    treasurySol: get("--treasury-sol"),
    dailyCap: get("--daily-cap") ? Number(get("--daily-cap")) : undefined,
    unlock: (get("--unlock") as UnlockMode) ?? "keychain",
    force: has("--force"),
    outDir: get("--out") ?? process.cwd(),
  };
}

async function getPassphrase(nonInteractive: boolean): Promise<Buffer> {
  if (nonInteractive) {
    const p = process.env.STARLING_PASSPHRASE;
    if (!p || p.length < 12) {
      throw new Error(
        "--non-interactive needs STARLING_PASSPHRASE (≥12 chars) in the environment",
      );
    }
    return Buffer.from(p, "utf8");
  }
  const { p1 } = await prompts({
    type: "password",
    name: "p1",
    message: "Keystore passphrase (min 12 chars)",
  });
  const { p2 } = await prompts({ type: "password", name: "p2", message: "Confirm passphrase" });
  if (!p1 || p1.length < 12) throw new Error("passphrase must be at least 12 characters");
  if (p1 !== p2) throw new Error("passphrases do not match");
  return Buffer.from(p1, "utf8");
}

export async function runInit(argv: string[]): Promise<void> {
  const f = parseFlags(argv);
  const network = f.network;
  out(
    `Starling wallet init — network: ${network}${
      network === "mainnet" ? "  (REAL FUNDS)" : "  (default; pass --mainnet to arm real money)"
    }`,
  );

  // venue selection
  let venues = f.venues;
  if (!f.nonInteractive) {
    const r = await prompts({
      type: "multiselect",
      name: "venues",
      message: "Select venues",
      choices: [
        { title: "Polymarket (Polygon)", value: "polygon", selected: true },
        { title: "Hyperliquid", value: "hyperliquid", selected: true },
        { title: "Solana (Jupiter)", value: "solana", selected: true },
      ],
      min: 1,
    });
    venues = (r.venues as Chain[]) ?? [];
  }
  if (venues.length === 0) throw new Error("no venues selected");

  // refuse to clobber unless --force
  for (const v of venues) {
    if (!f.force && (await keystoreExists(v))) {
      throw new Error(
        `${v}.keystore.json already exists. Use 'rotate' to re-key, or pass --force to overwrite.`,
      );
    }
  }

  // mainnet safety gate — the de-risking floor cannot be skipped
  let treasury = f.treasury;
  let dailyCap = f.dailyCap;
  if (network === "mainnet") {
    if (!f.nonInteractive) {
      if (!treasury) {
        const r = await prompts({
          type: "text",
          name: "t",
          message: "Treasury sweep address (required for mainnet)",
        });
        treasury = (r.t ?? "").trim();
      }
      if (!dailyCap) {
        const r = await prompts({
          type: "number",
          name: "c",
          message: "Daily notional cap in USD (must be > 0)",
        });
        dailyCap = Number(r.c);
      }
    }
    if (!treasury) throw new Error("--mainnet requires a treasury sweep address");
    if (!dailyCap || dailyCap <= 0) {
      throw new Error("--mainnet requires a non-zero --daily-cap (the de-risking floor)");
    }
  }

  const pass = await getPassphrase(f.nonInteractive);
  const lowRam = freeMem() < 256 * 1024 * 1024; // <256MiB free → use KDF floor
  // Per-chain treasury sealed into each keystore (EVM addr for polygon/HL, base58
  // for solana). The interactive mainnet gate above sets `treasury` (EVM).
  const treasuryEvm = f.treasuryEvm ?? treasury;
  const treasurySol = f.treasurySol;
  const wallets: Partial<Record<Chain, string>> = {};
  const recovery: RecoveryEntry[] = [];

  try {
    for (const chain of venues) {
      if (chain === "solana") {
        const k = generateSolanaKey();
        const { keystore, loweredKdf } = encryptKeystore(
          k.seed,
          pass,
          "solana",
          k.pubkeyBase58,
          randomUUID(),
          { lowRam, treasury: treasurySol },
        );
        if (loweredKdf) out("  ! low-RAM: KDF at OWASP minimum — use a longer passphrase");
        recovery.push({
          chain: "solana",
          address: k.pubkeyBase58,
          secretMaterial: solanaSecretKeyBase58(k.seed),
        });
        wallets.solana = k.pubkeyBase58;
        k.seed.fill(0);
        out(`  solana      -> ${await writeKeystore(keystore)}  (${k.pubkeyBase58})`);
      } else {
        const k = generateEvmKey();
        const { keystore, loweredKdf } = encryptKeystore(
          k.secret,
          pass,
          chain,
          k.address,
          randomUUID(),
          { lowRam, treasury: treasuryEvm },
        );
        if (loweredKdf) out("  ! low-RAM: KDF at OWASP minimum — use a longer passphrase");
        recovery.push({
          chain,
          address: k.address,
          secretMaterial: `0x${Buffer.from(k.secret).toString("hex")}`,
        });
        wallets[chain] = k.address;
        k.secret.fill(0);
        out(`  ${chain.padEnd(11)} -> ${await writeKeystore(keystore)}  (${k.address})`);
        if (chain === "hyperliquid") {
          out(
            "  HL: your MASTER account must now sign ONE approveAgent for this agent\n" +
              `      address (stable name "starling-agent", 30-day expiry). The agent key is\n` +
              "      trade-not-withdraw. Run: agent-wallet approve-hl  (needs @nktkas/hyperliquid)",
          );
        }
      }
    }
  } finally {
    pass.fill(0); // best-effort
  }

  // non-secret integration files
  const cfg: StarlingConfig = {
    version: 1,
    network,
    signerBackend: "local",
    unlockMode: f.unlock,
    treasury: Object.fromEntries(
      venues
        .map((v) => [v, v === "solana" ? treasurySol : treasuryEvm] as const)
        .filter(([, a]) => !!a),
    ),
    guardrails: {
      perTradeMaxUsd: 0,
      dailyNotionalCapUsd: dailyCap ?? 0,
      allowlist: [],
      killSwitch: false,
    },
    wallets,
  };
  const cfgPath = await writeConfig(cfg);
  const mcpPath = await writeMcpJson(cfg, f.outDir);
  await appendIgnore(".gitignore", f.outDir);
  await appendIgnore(".dockerignore", f.outDir);
  const sheetPath = await writeRecoverySheet(renderRecoverySheet(recovery, cfg));

  out("");
  out(`  config       -> ${cfgPath}`);
  out(`  mcp.json     -> ${mcpPath}`);
  out(`  recovery     -> ${sheetPath}   (MOVE OFFLINE AND SHRED)`);
  out("");
  out(
    network === "mainnet"
      ? "Mainnet armed. Point your agent at mcp.json and start the Starling MCP server."
      : "Testnet ready. Verify with the Starling MCP server, then re-run with --mainnet to arm real money.",
  );
}
