#!/usr/bin/env node
// src/bin/agent-wallet.ts — the single CLI entrypoint.
//   agent-wallet init [--out <dir>] [--daily-cap <usd>] [--testnet]
//   agent-wallet doctor
//   agent-wallet --version | --help

const VERSION = "2.0.0";

const HELP = `Starling Agent Wallet — create a trading bot's wallets for the Starling MCP.

Usage:
  agent-wallet init        Create a new bot: 3 wallets, mcp.json, WALLETS.txt
  agent-wallet doctor      Quick environment + hygiene check
  agent-wallet --version
  agent-wallet --help

init creates all three wallets (Polygon, Hyperliquid, Solana) on mainnet, with
NO prompts and NO password. The private keys are written into mcp.json (which
your agent reads) and into a plain-English WALLETS.txt telling you which
addresses to fund. Everything lands in one folder — run init in a new folder to
make another bot.

init flags:
  --out <dir>              Folder to create the bot in (default: current folder)
  --daily-cap <usd>        Daily notional cap the MCP enforces (default: 1,000,000)
  --testnet                Use testnet instead of mainnet (default: mainnet)

The keys live as plaintext env vars in mcp.json — keep that file private (it's
gitignored for you). Keys are generated on your machine and never leave it.`;

async function main(): Promise<void> {
  const cmd = process.argv[2];
  const rest = process.argv.slice(3);
  switch (cmd) {
    case "init":
      return (await import("../cli/wizard.js")).runInit(rest);
    case "doctor":
      return (await import("../cli/doctor.js")).run();
    case "--version":
    case "-v":
      process.stdout.write(VERSION + "\n");
      return;
    case undefined:
    case "--help":
    case "-h":
      process.stdout.write(HELP + "\n");
      return;
    default:
      process.stderr.write(`unknown command "${cmd}"\n\n${HELP}\n`);
      process.exitCode = 2;
  }
}

main().catch((e) => {
  process.stderr.write(`\nagent-wallet: ${e?.message ?? e}\n`);
  process.exit(1);
});
