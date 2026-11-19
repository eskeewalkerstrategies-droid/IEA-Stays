import { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { actorForToken } from "./auth.js";
import { buildMcpServer } from "./server.js";
import { recordEvent } from "../events.js";

/**
 * Streamable HTTP endpoint at /mcp. Stateless: each request gets a fresh server and transport bound to the
 * actor named by the bearer token. That keeps it simple behind Coolify and across restarts.
 */
export const mcpRoutes = new Hono();

mcpRoutes.all("/mcp", async (c) => {
  const actor = actorForToken(c.req.header("authorization"));
  if (!actor) {
    return c.json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized: send Authorization: Bearer <OPS_MCP token>" }, id: null }, 401);
  }
  if (c.req.method === "GET" || c.req.method === "DELETE") return c.text("Method not allowed in stateless mode", 405);
  const server = buildMcpServer(actor);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    const res = await transport.handleRequest(c.req.raw);
    return res;
  } catch (err) {
    await recordEvent({ type: "mcp_error", actor, payload: { error: String(err) } });
    return c.json({ jsonrpc: "2.0", error: { code: -32603, message: String(err) }, id: null }, 500);
  } finally {
    queueMicrotask(() => {
      void transport.close();
      void server.close();
    });
  }
});
