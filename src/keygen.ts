// src/keygen.ts
// Per-chain key generation. ONE CSPRNG for all key material:
// node:crypto.randomBytes (OpenSSL/platform CSPRNG). We deliberately do NOT use
// @noble's pluggable RNG hooks for key generation, and everything runs in the
// main process — never a forked worker (post-fork RNG-state duplication).
import { randomBytes } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1";
import { ed25519 } from "@noble/curves/ed25519";
import { keccak_256 } from "@noble/hashes/sha3";
import { base58 } from "@scure/base";

function csprng(n: number): Buffer {
  return randomBytes(n); // Buffer (a Uint8Array); caller zeroizes
}

/** EIP-55 checksummed address from a secp256k1 private key. No viem dependency. */
export function privateKeyToEvmAddress(secret: Uint8Array): `0x${string}` {
  const pub = secp256k1.getPublicKey(secret, false); // 65 bytes: 0x04 || X || Y
  const hashed = keccak_256(pub.slice(1)); // hash X||Y
  const addrBytes = hashed.slice(-20);
  const lower = Buffer.from(addrBytes).toString("hex");
  const checkHash = Buffer.from(keccak_256(new TextEncoder().encode(lower))).toString("hex");
  let out = "0x";
  for (let i = 0; i < lower.length; i++) {
    const c = lower[i];
    out += parseInt(checkHash[i], 16) >= 8 ? c.toUpperCase() : c;
  }
  return out as `0x${string}`;
}

export interface EvmKey {
  secret: Buffer;
  address: `0x${string}`;
}
export interface SolKey {
  /** raw 32-byte ed25519 seed (exportable — so it can be sealed in the keystore) */
  seed: Buffer;
  pubkeyBase58: string;
}

/** secp256k1 for the Polymarket owner EOA and the Hyperliquid agent key. */
export function generateEvmKey(): EvmKey {
  let secret: Buffer;
  do {
    secret = csprng(32);
  } while (!secp256k1.utils.isValidPrivateKey(secret));
  return { secret, address: privateKeyToEvmAddress(secret) };
}

/**
 * ed25519 for Solana, generated as a RAW 32-byte seed via the platform CSPRNG.
 * Raw-seed (not a non-extractable WebCrypto key) is required so the secret can
 * be exported into the encrypted keystore; the MCP server re-imports it to sign.
 */
export function generateSolanaKey(): SolKey {
  const seed = csprng(32);
  const pub = ed25519.getPublicKey(seed); // 32-byte pubkey
  return { seed, pubkeyBase58: base58.encode(pub) };
}

/**
 * Standard Solana secret key (64 bytes: seed || pubkey) as base58 — the format
 * Phantom/solana-keygen import. Used for the offline recovery sheet / `export`.
 */
export function solanaSecretKeyBase58(seed: Uint8Array): string {
  const pub = ed25519.getPublicKey(seed);
  const full = new Uint8Array(64);
  full.set(seed, 0);
  full.set(pub, 32);
  return base58.encode(full);
}
