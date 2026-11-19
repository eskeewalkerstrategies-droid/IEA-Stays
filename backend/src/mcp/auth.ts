import { config } from "../config.js";

/**
 * Bearer token sign-in for the Ops MCP server. OPS_MCP_TOKENS holds "name:token,name:token"; the name becomes
 * the actor on every event, so the audit trail shows who did what (jitaksh, agent-followup, ...).
 */
export function actorForToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  if (!m) return null;
  return config().mcpTokens.get(m[1].trim()) ?? null;
}
