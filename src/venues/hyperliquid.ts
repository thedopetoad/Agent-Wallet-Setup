// src/venues/hyperliquid.ts
// Hyperliquid's native trade-not-withdraw de-risking: a freshly generated
// secp256k1 "agent" key is approved ONCE by the master account. A leaked agent
// key can trade the balance but CANNOT withdraw or transfer off-platform.
//
// The @nktkas/hyperliquid SDK is an OPTIONAL dependency (loaded lazily) so the
// core install + keystore tooling never depends on a live-network SDK. If it is
// missing we throw a clear "npm i" hint rather than a cryptic resolution error.

export const HL_MAX_VALIDITY_MS = 180 * 24 * 60 * 60 * 1000; // protocol cap
export const HL_MAX_NAMED_AGENTS = 3; // + 1 unnamed; 2 per subaccount
export const STABLE_AGENT_NAME = "starling-agent";
const DEFAULT_VALIDITY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * HL encodes expiry by CONVENTION inside the agent name. A STABLE base name is
 * load-bearing: re-approving the SAME name REPLACES the prior agent in place, so
 * rotate/revoke never create a distinct named agent and never hit the 3-agent
 * cap. (There is no `approveAgentWithExpiry` helper.)
 */
export function buildAgentName(validUntilMs: number, base = STABLE_AGENT_NAME): string {
  return `${base} valid_until ${validUntilMs}`;
}

/** Lazy-load the optional SDK with a friendly error if it isn't installed. */
async function loadHlSdk(): Promise<any> {
  const spec = "@nktkas/hyperliquid";
  try {
    return await import(spec);
  } catch {
    throw new Error(
      "Hyperliquid support needs the optional SDK. Install it with:\n" +
        "  npm i @nktkas/hyperliquid",
    );
  }
}

export interface ApproveAgentArgs {
  /** master account private key (0x…) — used ONCE, never stored in the keystore. */
  masterPrivateKey: `0x${string}`;
  /** the freshly generated agent address to authorise. */
  agentAddress: `0x${string}`;
  validUntilMs?: number; // default now + 30 days
  testnet?: boolean;
}

/** Master signs ONE approveAgent for the agent key. */
export async function approveAgent(a: ApproveAgentArgs): Promise<{ agentName: string }> {
  const now = Date.now();
  const validUntil = a.validUntilMs ?? now + DEFAULT_VALIDITY_MS;
  if (validUntil <= now) throw new Error("valid_until must be in the future");
  if (validUntil - now > HL_MAX_VALIDITY_MS) {
    throw new Error(
      `HL agent validity is capped at 180 days (requested ${Math.floor((validUntil - now) / 86_400_000)}d)`,
    );
  }
  const hl = await loadHlSdk();
  const transport = new hl.HttpTransport({ isTestnet: a.testnet ?? true });
  const client = new hl.ExchangeClient({ wallet: a.masterPrivateKey, transport });
  const agentName = buildAgentName(validUntil);
  await client.approveAgent({ agentAddress: a.agentAddress, agentName });
  return { agentName };
}

/** revoke = re-approve the SAME stable name with a past validUntil (deregister in place). */
export async function revokeAgent(a: Omit<ApproveAgentArgs, "validUntilMs">): Promise<void> {
  const hl = await loadHlSdk();
  const transport = new hl.HttpTransport({ isTestnet: a.testnet ?? true });
  const client = new hl.ExchangeClient({ wallet: a.masterPrivateKey, transport });
  await client.approveAgent({
    agentAddress: a.agentAddress,
    agentName: buildAgentName(Date.now() - 1),
  });
}

/** Before creating a NEW-named agent, refuse if the account already has 3. */
export function assertAgentSlotAvailable(existingNamedAgents: { name: string }[]): void {
  const distinct = new Set(existingNamedAgents.map((x) => x.name.split(" valid_until ")[0]));
  // Reusing STABLE_AGENT_NAME is fine (replaces in place); a NEW base name fills a slot.
  if (!distinct.has(STABLE_AGENT_NAME) && distinct.size >= HL_MAX_NAMED_AGENTS) {
    throw new Error(
      `Hyperliquid allows ${HL_MAX_NAMED_AGENTS} named agents; account already has ${distinct.size}. ` +
        `Revoke one first (Starling reuses the stable name "${STABLE_AGENT_NAME}").`,
    );
  }
}
