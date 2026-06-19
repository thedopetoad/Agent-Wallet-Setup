#!/usr/bin/env node
// src/bin/agent-wallet.ts — the single CLI entrypoint.
//   agent-wallet init [--mainnet] [--venues a,b] [--non-interactive] [--unlock m]
//   agent-wallet doctor
//   agent-wallet export --venue <chain>
//   agent-wallet --version | --help

const VERSION = "1.0.0";

const HELP = `Starling Agent Wallet — create & store keys for the Starling MCP.

Usage:
  agent-wallet init        Generate + encrypt your agent's keys (interactive)
  agent-wallet import      Encrypt a private key you ALREADY have (--venue <chain>)
  agent-wallet doctor      Preflight + hygiene checks
  agent-wallet export      Print a key in a standard portable format
  agent-wallet unlock      Store the passphrase in the OS keychain (desktop)
  agent-wallet --version
  agent-wallet --help

init flags:
  --mainnet                Arm real funds (requires --treasury + --daily-cap)
  --venues a,b,c           polygon,hyperliquid,solana (default: all)
  --unlock <mode>          keychain|env|tpm|kms|file (default: keychain)
  --non-interactive        Read passphrase from STARLING_PASSPHRASE env
  --out <dir>              Where to write mcp.json/.gitignore (default: cwd)
  --force                  Overwrite existing keystores

Keys live encrypted in ~/.starling/keystore (override with STARLING_DIR).
The Starling MCP reads the same keystores to sign. Keys never leave your box.`;

async function main(): Promise<void> {
  const cmd = process.argv[2];
  const rest = process.argv.slice(3);
  switch (cmd) {
    case "init":
      return (await import("../cli/wizard.js")).runInit(rest);
    case "doctor":
      return (await import("../cli/doctor.js")).run();
    case "export":
      return (await import("../cli/export.js")).run(rest);
    case "import":
      return (await import("../cli/import.js")).run(rest);
    case "unlock":
      return (await import("../cli/unlock.js")).run(rest);
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
