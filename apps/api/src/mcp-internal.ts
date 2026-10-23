/**
 * Re-export so apps/api-worker can wire MCP without importing the full remote-mcp
 * graph at config time. Seam kept tiny for Workers bundle control.
 */
export { setMcpInternalFetch } from "./remote-mcp.js";
