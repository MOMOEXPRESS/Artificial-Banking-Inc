# Agent connections to ABI

Reviewed 12 October 2026 against the repository and official documentation.

ABI is provider-independent. An exhaustive named list is impossible: any custom runtime that can make authenticated HTTPS requests and handle structured results can integrate.

| Path           | Implemented                                                              | Limitations                                                                                                                        |
| -------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Hosted MCP     | POST /mcp/[session-token], Streamable HTTP, stateless JSON tool requests | Sandbox only; read scope required, payment tool only with pay scope; console sessions last 24 hours; no OAuth or SSE-only endpoint |
| Local MCP      | apps/mcp-server runs over stdio                                          | Configure API origin and agent credential in the client's environment; API enforces policy and scopes                              |
| HTTP API       | /v1/agent/budget, /simulate, /pay, /pay_api, approvals/activity/escrow   | Bearer agent/session credentials required; custom tool, retry/idempotency and approval handling needed                             |
| TypeScript SDK | PolicyVaultClient in packages/sdk                                        | Workspace package; no public @abi/sdk distribution or native Python SDK is shipped                                                 |

## Named examples

These are **documented compatible clients/frameworks, not individually certified ABI integrations**. ABI's generic MCP tests cover initialization, read-only scopes and sandbox tools. Each actual client's transport, account settings, credentials and behavior still need verification.

| Client/framework                                                  | ABI path                                              | Official documentation                                                      |
| ----------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------- |
| ChatGPT developer-mode custom app                                 | Existing hosted sandbox MCP proof                     | ABI current implementation; account/organization availability varies        |
| Claude Code                                                       | stdio or compatible HTTP MCP                          | https://code.claude.com/docs/en/mcp                                         |
| Cursor IDE / CLI / configured cloud agents                        | stdio or compatible HTTP MCP                          | https://cursor.com/docs/mcp                                                 |
| GitHub Copilot agent in VS Code                                   | Configured stdio/HTTP MCP                             | https://code.visualstudio.com/docs/agent-customization/mcp-servers          |
| Gemini CLI                                                        | Configured MCP                                        | https://geminicli.com/docs/tools/mcp-server/                                |
| Codex CLI                                                         | Configured stdio/HTTP MCP                             | https://learn.chatgpt.com/docs/extend/mcp?surface=cli                       |
| Cascade / legacy Windsurf                                         | Configured MCP; current product/admin settings matter | https://docs.devin.ai/desktop/cascade/mcp                                   |
| Cline                                                             | Configured MCP                                        | https://docs.cline.bot/mcp/mcp-overview                                     |
| Roo Code                                                          | Configured MCP                                        | https://roocodeinc.github.io/Roo-Code/features/mcp/overview/                |
| OpenAI Agents SDK                                                 | MCP or custom HTTP tool                               | https://openai.github.io/openai-agents-python/mcp/                          |
| LangChain / LangGraph                                             | MCP adapter or custom HTTP tool                       | https://docs.langchain.com/oss/python/langchain/mcp                         |
| CrewAI                                                            | MCP or custom HTTP tool                               | https://docs.crewai.com/v1.15.27/en/mcp/overview                            |
| Pydantic AI                                                       | MCP toolsets or custom HTTP tool                      | https://pydantic.dev/docs/ai/mcp/overview/                                  |
| Mastra                                                            | MCP or SDK/custom tool                                | https://mastra.ai/docs/connections/mcp                                      |
| Vercel AI SDK                                                     | MCP or custom HTTP tool                               | https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools                               |
| Custom Python, TypeScript, Go, Java, C#, Rust agents              | HTTP API                                              | Use ABI's schema and implement result/approval handling                     |
| Tool-capable local model runtime: Ollama-hosted Llama, Qwen, etc. | Runtime invokes HTTP/MCP tools                        | A model alone does not connect; surrounding code owns credentials and tools |
| Custom automation workflow                                        | HTTP node/action                                      | Requires custom configuration; no one-click ABI integration is shipped      |

## Connecting

Build the repo packages. For stdio, configure Node to launch apps/mcp-server/dist/index.js from the absolute checkout path. Set POLICYVAULT_API_URL and POLICYVAULT_API_KEY through the client's secure environment configuration.

Start in sandbox with read-only access. The local MCP budget tool is get_budget; the hosted tool is abi_get_spending_capacity. Use an agent credential, not a guardian or wallet private key. Never publish a credential-bearing MCP URL or put credentials in a prompt.

A REVIEW result is waiting for human authorization; it is not settlement. A client requiring OAuth or only old SSE cannot use the current hosted proof unchanged. Persistent provider connectors and dedicated framework adapters are absent. Protocol compatibility is not proof that live payments were tested with a named provider.
