// src/cli/unlock.ts
// `agent-wallet unlock` — store the keystore passphrase in the OS keychain
// (macOS Keychain / Windows Credential Manager / Linux Secret Service) so the
// Starling MCP can unlock at boot with STARLING_UNLOCK_MODE=keychain and
// no prompt. Uses the OPTIONAL @napi-rs/keyring native module; if it isn't
// installed (or there's no Secret Service, e.g. headless Linux) it tells you to
// use --unlock env|tpm|kms instead.
import prompts from "prompts";

const SERVICE = "starling-mcp";
const ACCOUNT = "keystore-passphrase";

async function loadKeyring(): Promise<any> {
  const spec = "@napi-rs/keyring";
  try {
    return await import(spec);
  } catch (e) {
    throw new Error(
      "OS keychain unavailable (" +
        (e as Error).message +
        ").\n" +
        "Install the optional module:  npm i @napi-rs/keyring\n" +
        "…or use a headless unlock mode: STARLING_UNLOCK_MODE=env|tpm|kms",
    );
  }
}

export async function run(_argv: string[]): Promise<void> {
  const passStr = process.env.STARLING_PASSPHRASE
    ? process.env.STARLING_PASSPHRASE
    : (await prompts({ type: "password", name: "p", message: "Keystore passphrase to store in keychain" })).p;
  if (!passStr) throw new Error("no passphrase");

  const { Entry } = await loadKeyring();
  new Entry(SERVICE, ACCOUNT).setPassword(passStr);
  process.stdout.write(
    `Stored passphrase in the OS keychain (${SERVICE}/${ACCOUNT}).\n` +
      "The MCP will unlock at boot with STARLING_UNLOCK_MODE=keychain.\n",
  );
}
