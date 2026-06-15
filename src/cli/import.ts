// src/cli/import.ts
// `agent-wallet import --venue <chain>` — encrypt a private key you ALREADY have
// into the keystore. The upgrade path from a plaintext key (env/file) to the
// encrypted keystore, without regenerating. Use the SAME passphrase as your
// other venues so the MCP can unlock them all together.
import prompts from "prompts";
import { randomUUID } from "node:crypto";
import {
  parseEvmSecret,
  parseSolanaSeed,
  privateKeyToEvmAddress,
  seedToSolanaAddress,
} from "../keygen.js";
import { encryptKeystore } from "../keystore/crypto.js";
import { writeKeystore, keystoreExists } from "../keystore/store.js";
import { CHAINS, type Chain } from "../keystore/format.js";
import { freeMem } from "../util.js";

const out = (m: string) => process.stdout.write(m + "\n");

export async function run(argv: string[]): Promise<void> {
  const vi = argv.indexOf("--venue");
  const venue = (vi >= 0 ? argv[vi + 1] : undefined) as Chain | undefined;
  const force = argv.includes("--force");
  if (!venue || !(CHAINS as readonly string[]).includes(venue)) {
    throw new Error("usage: agent-wallet import --venue <polygon|hyperliquid|solana> [--force]");
  }
  if ((await keystoreExists(venue)) && !force) {
    throw new Error(`${venue}.keystore.json already exists — pass --force to overwrite (or use 'rotate').`);
  }

  // The private key to import.
  const keyStr =
    process.env.STARLING_IMPORT_KEY ??
    (await prompts({ type: "password", name: "k", message: `Paste the ${venue} private key` })).k;
  if (!keyStr) throw new Error("no key provided");

  // The keystore passphrase (must match your existing keystores).
  const passStr =
    process.env.STARLING_PASSPHRASE ??
    (await prompts({ type: "password", name: "p", message: "Keystore passphrase (same as your other venues)" })).p;
  if (!passStr || passStr.length < 12) throw new Error("passphrase must be at least 12 characters");
  const pass = Buffer.from(passStr, "utf8");

  const isSol = venue === "solana";
  const secret = isSol ? parseSolanaSeed(keyStr) : parseEvmSecret(keyStr);
  const address = isSol ? seedToSolanaAddress(secret) : privateKeyToEvmAddress(secret);

  try {
    const { keystore, loweredKdf } = encryptKeystore(
      secret,
      pass,
      venue,
      address,
      randomUUID(),
      { lowRam: freeMem() < 256 * 1024 * 1024 },
    );
    if (loweredKdf) out("  ! low-RAM: KDF at OWASP minimum — use a longer passphrase");
    out(`  ${venue} -> ${await writeKeystore(keystore)}  (${address})`);
  } finally {
    secret.fill(0);
    pass.fill(0);
  }
  out("Imported and encrypted. The Starling MCP can now sign for this venue from the keystore.");
}
