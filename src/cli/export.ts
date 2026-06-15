// src/cli/export.ts
// `agent-wallet export --venue <chain>` — decrypt a keystore and print standard
// portable material (hex private key for EVM, base58 64-byte secret for Solana)
// so the key is recoverable without Starling. Requires the passphrase.
import prompts from "prompts";
import { readKeystore } from "../keystore/store.js";
import { decryptKeystore } from "../keystore/crypto.js";
import { solanaSecretKeyBase58 } from "../keygen.js";
import type { Chain } from "../keystore/format.js";

export async function run(argv: string[]): Promise<void> {
  const i = argv.indexOf("--venue");
  const venue = (i >= 0 ? argv[i + 1] : undefined) as Chain | undefined;
  if (!venue) throw new Error("usage: agent-wallet export --venue <polygon|hyperliquid|solana>");

  const passStr = process.env.STARLING_PASSPHRASE
    ? process.env.STARLING_PASSPHRASE
    : (await prompts({ type: "password", name: "p", message: "Keystore passphrase" })).p;
  if (!passStr) throw new Error("no passphrase");
  const pass = Buffer.from(passStr, "utf8");

  const ks = await readKeystore(venue);
  const secret = decryptKeystore(ks, pass);
  pass.fill(0);
  try {
    process.stderr.write(
      "\n!! This prints a secret to your terminal. Clear scrollback afterwards.\n\n",
    );
    if (venue === "solana") {
      process.stdout.write(`${venue} ${ks.address}\n${solanaSecretKeyBase58(secret)}\n`);
    } else {
      process.stdout.write(`${venue} ${ks.address}\n0x${Buffer.from(secret).toString("hex")}\n`);
    }
  } finally {
    secret.fill(0);
  }
}
