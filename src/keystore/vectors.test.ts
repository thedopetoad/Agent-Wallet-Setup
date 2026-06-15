// src/keystore/vectors.test.ts
// Proves this repo can decrypt the SHARED frozen keystore vector (identical file
// ships in Starling-MCP). If src/keystore/crypto.ts ever drifts incompatibly,
// this fails here AND there — that's the cross-repo interop guarantee.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ed25519 } from "@noble/curves/ed25519";
import { base58 } from "@scure/base";
import { decryptKeystore } from "./crypto.js";
import { privateKeyToEvmAddress } from "../keygen.js";
import { VECTORS, VECTOR_PASSPHRASE } from "./vectors.js";

for (const v of VECTORS) {
  test(`decrypts the shared ${v.chain} vector to the expected secret`, () => {
    const secret = decryptKeystore(v.keystore, Buffer.from(VECTOR_PASSPHRASE, "utf8"));
    assert.equal(Buffer.from(secret).toString("hex"), v.secretHex);

    // Re-derive the address from the decrypted secret → must match the envelope.
    const derived =
      v.chain === "solana"
        ? base58.encode(ed25519.getPublicKey(secret))
        : privateKeyToEvmAddress(secret);
    assert.equal(derived, v.address);
    secret.fill(0);
  });
}
