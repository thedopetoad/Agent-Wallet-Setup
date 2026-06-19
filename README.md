# Starling Agent Wallet

**The safe way to create and store an agent's trading keys for the
[Starling MCP](https://github.com/thedopetoad/Starling-MCP).**

Generate per-chain keys, de-risk each one for its venue, and seal them in an
encrypted local keystore. **Your keys are generated on your machine and never
leave it.** The Starling MCP reads the same keystore to sign — this tool
is the *producer*, the MCP is the *consumer*, and the
[Starling Keystore v1 format](./KEYSTORE_FORMAT.md) is the contract between them.

> **This is the optional safety layer.** The
> [Starling MCP](https://github.com/thedopetoad/Starling-MCP) works fine with a
> plaintext key pasted into an env var — that's the easy path for testnet / small
> float. This tool is for when you want your keys **encrypted at rest** instead,
> with nothing to install but Node. Already have a key? `agent-wallet import`
> encrypts it without regenerating.

> **Prerequisite:** Node 20+ on your `PATH`. (MCP hosts like Claude Desktop and
> Cursor do **not** bundle Node — run `node -v` to confirm. `agent-wallet doctor`
> checks this for you.)

## Quick start

Clone the repo and run it yourself — nothing is published to npm.

```bash
git clone https://github.com/thedopetoad/Agent-Wallet-Setup
cd Agent-Wallet-Setup
npm install            # the `prepare` script builds to dist/ for you

# generate + encrypt your agent's wallet (interactive)
node dist/bin/agent-wallet.js init

# health + hygiene check
node dist/bin/agent-wallet.js doctor
```

`npm install` runs the `prepare` script, which builds `dist/` — so a separate
`npm run build` is **optional** (run it only to rebuild after editing source).

The wizard:

1. **Picks venues** — Polymarket (Polygon), Hyperliquid, Solana (Jupiter).
2. **Defaults to testnet.** `--mainnet` is required to arm real funds, and it
   *refuses* to arm without a treasury sweep address and a non-zero daily cap.
3. **Generates keys in-process** — secp256k1 (Polygon/HL) and ed25519 (Solana),
   all from one CSPRNG (`node:crypto.randomBytes`).
4. **Encrypts** each key to `~/.starling/keystore/<chain>.keystore.json`
   (argon2id + XChaCha20-Poly1305), written atomically at `0600`.
5. **Writes integration files** — `mcp.json` for your agent host, appends guards
   to `.gitignore`/`.dockerignore`, and renders an **offline recovery sheet** you
   move off the box and shred.

The `mcp.json` it writes launches the MCP from **your local
[Starling-MCP](https://github.com/thedopetoad/Starling-MCP) clone** (`command:
"node"`, `args: ["…/dist/bin/starling-mcp.js"]`). It can't know where you cloned
it, so it writes a placeholder path — edit the `args` path to point at your
clone, **or** set `STARLING_MCP_DIR` (the clone root) before running `init` and
the wizard fills it in for you. See [pairing](#how-it-pairs-with-starling-mcp).

## The four things this gets right

1. **Generate** — audited libraries (`@noble/curves`, `@noble/hashes`), platform
   CSPRNG only, in-process, no shelling out to `cast`/`solana-keygen`/`openssl`.
2. **De-risk** — per venue:
   - **Hyperliquid** → a fresh **agent key** approved once by your master account
     (`agent-wallet approve-hl`, needs the optional `@nktkas/hyperliquid`). It can
     **trade but not withdraw**, expires, and is revocable in place.
   - **Polymarket / Solana** → fresh **thin** dedicated wallets, profit swept to a
     **treasury** address the agent never holds. These keys are **not**
     withdraw-restricted (no chain primitive for it) — the guardrail is thin float
     + sweep + the MCP's per-trade/daily caps. The wizard says so plainly.
3. **Store** — an encrypted keystore unlocked at boot, **never** a plaintext
   `.env`. See [unlock modes](#unlock-modes).
4. **No browser exposure** — this is a Node-only package with no Next.js client
   path, so key code structurally cannot reach a browser bundle. Never put a key
   in a `NEXT_PUBLIC_*` variable (it gets inlined into client JS); `doctor` greps
   for that mistake.

## Unlock modes

How the MCP gets the passphrase at boot, set as `STARLING_UNLOCK_MODE`:

| mode | where the secret comes from | survives unattended restart? | resists stolen disk? |
|---|---|---|---|
| `keychain` | OS keychain (`agent-wallet unlock`) | only if a GUI/login session persists | yes |
| `env` | `STARLING_KEYSTORE_PASSPHRASE` (inject via a secrets manager) | yes | partial (`/proc` readable) |
| `tpm` | systemd `LoadCredentialEncrypted` (TPM2-sealed) | yes | yes (machine-bound) |
| `kms` | cloud KMS via the instance role | yes | yes |
| `file` | a `0400` file | yes | **no** — **forbidden on `--mainnet`** |

**The honest ceiling:** on an always-on box, anything that can run code as your
user can sign trades. The keystore stops a stolen *backup/disk*, not a live
breach. Your real protection is thin, trade-not-withdraw, expiring wallets — keep
the float small and the master/treasury keys off this box.

## Commands

| command | does |
|---|---|
| `agent-wallet init` | generate + encrypt keys, write `mcp.json`, recovery sheet |
| `agent-wallet import --venue <chain>` | encrypt a private key you ALREADY have (upgrade plaintext → encrypted) |
| `agent-wallet doctor` | preflight + hygiene checks |
| `agent-wallet unlock` | store the passphrase in the OS keychain |
| `agent-wallet export --venue <chain>` | print a standard portable key for recovery |

## How it pairs with Starling-MCP

```
agent-wallet init                the MCP at boot (your Starling-MCP clone)
  └─ writes ~/.starling/   ─────▶  └─ reads ~/.starling/, unlocks via
     keystore/*.json                  STARLING_UNLOCK_MODE, exposes
     config.json, mcp.json            getEvmSigner()/getSolanaSigner()
```

The agent host reads the `mcp.json` written here and launches the MCP locally:
`node /your/clone/Starling-MCP/dist/bin/starling-mcp.js`. Clone Starling-MCP and
run `npm install` (its `prepare` script builds `dist/`) so that path exists, then
point the `mcp.json` `args` at it (or set `STARLING_MCP_DIR` before `init`).

Both repos pin the identical `src/keystore/crypto.ts` and a shared decryption
test vector, so a keystore written here always decrypts there. License: MIT.
