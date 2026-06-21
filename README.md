# Starling Agent Wallet

**Make a trading bot's wallets in one command — for the
[Starling MCP](https://github.com/thedopetoad/Starling-MCP).**

`agent-wallet init` generates the three wallets a bot needs (Polygon, Hyperliquid,
Solana), wires them into an `mcp.json` your agent reads, and writes a plain-English
`WALLETS.txt` telling you which addresses to fund. **No prompts, no password,
nothing to configure.** Keys are generated on your machine and never leave it.

> **Want another bot?** Run `init` again in a different folder. Each bot is
> self-contained in its own folder — a second bot never touches the first.

> **Prerequisite:** Node 20+ on your `PATH`. (MCP hosts like Claude Desktop and
> Cursor do **not** bundle Node — run `node -v` to confirm. `agent-wallet doctor`
> checks this for you.)

## Quick start

```bash
# clone both repos side by side so the wallet tool can find the MCP
git clone https://github.com/thedopetoad/Starling-MCP
git clone https://github.com/thedopetoad/Agent-Wallet-Setup

cd Agent-Wallet-Setup && npm install   # the prepare script builds dist/ for you
cd ../Starling-MCP     && npm install   # build the MCP too

# create a bot (run this wherever you want the bot's folder to live)
mkdir ../my-bot && cd ../my-bot
node ../Agent-Wallet-Setup/dist/bin/agent-wallet.js init
```

That's it. `init` prints the three wallet addresses and writes three files into
the current folder:

| file | what it is |
|---|---|
| `mcp.json` | point your agent host (Claude Desktop / Cursor) at this — it has the keys baked in |
| `WALLETS.txt` | the addresses to **fund**, and the private keys to **back up** (keep it offline) |
| `config.json` | non-secret summary (network, addresses, daily cap) |

Then: **(1)** send funds to the three addresses in `WALLETS.txt`, **(2)** back up
`WALLETS.txt` somewhere safe and offline, **(3)** start your agent.

## What `init` does

1. **Generates all three wallets** — secp256k1 for Polygon & Hyperliquid, ed25519
   for Solana, all from the platform CSPRNG (`node:crypto.randomBytes`), in-process.
2. **Mainnet by default** (pass `--testnet` to use a test network instead).
3. **Writes the keys as plaintext env vars** (`STARLING_PK_POLYGON` /
   `_HYPERLIQUID` / `_SOLANA`) into `mcp.json`. The Starling MCP's `env` key source
   reads them directly — so there is no keystore, no passphrase, and no unlock step.
4. **Auto-finds your Starling-MCP clone** (a sibling `../Starling-MCP` or one
   inside the folder) and points `mcp.json` at it. Set `STARLING_MCP_DIR` to
   override.
5. **Guards your keys from git** — appends `mcp.json`, `WALLETS.txt`, and
   `config.json` to `.gitignore`/`.dockerignore`, and writes the key files `0600`.

### A note on Hyperliquid

The Hyperliquid wallet is its **own account** — fund it and it trades immediately.
There is no separate "approve this agent" step to do.

## Commands

| command | does |
|---|---|
| `agent-wallet init` | create a bot: 3 wallets, `mcp.json`, `WALLETS.txt`, `config.json` |
| `agent-wallet doctor` | quick environment + hygiene check (Node, CSPRNG, keys gitignored) |

### `init` flags

| flag | default | meaning |
|---|---|---|
| `--out <dir>` | current folder | where to create the bot |
| `--daily-cap <usd>` | `1000000` | daily notional cap the MCP enforces |
| `--testnet` | off (mainnet) | use a test network instead of mainnet |

## Security — read this

The keys are stored **in plaintext** in `mcp.json` and `WALLETS.txt`. This is the
easy path, and it means anything that can read those files (or this machine's
environment) can sign trades. So:

- **Keep the float small.** These are hot wallets. Only fund what the bot needs.
- **Never commit or share `mcp.json` / `WALLETS.txt`.** They're gitignored for you
  — keep them that way, and keep `WALLETS.txt` backed up offline.
- **To retire a bot,** move its funds out and delete its folder.

## How it pairs with Starling-MCP

```
agent-wallet init                 the MCP at boot (your Starling-MCP clone)
  └─ writes ./mcp.json     ─────▶   └─ reads STARLING_PK_* from its env,
     (keys in env block)               signs with the env key source
```

The agent host reads `mcp.json` and launches the MCP locally with the keys in its
environment (`STARLING_KEY_SOURCE=env`). Clone Starling-MCP next to this repo and
run `npm install` (its `prepare` script builds `dist/`) so the auto-detected path
exists. License: MIT.
