# Phase 7 plan: AI and MCP

Branch `phase-7`, from `phase-6`. Started straight after Phase 6, as the owner asked; the recommended option is taken at each choice and recorded here. AI is off by default, and everything works with it off.

## Goal

Optional AI that helps parents and only ever proposes: plain-English control ("let him have YouTube until tea" becomes a card to approve), job suggestions, and a weekly family summary. And an MCP server, so Claude (or another assistant the owner registers) can read the family's status and propose an Allow that Mum approves in the app.

## Exit criteria

1. Here: an MCP client in the tests signs in through the platform's OAuth (passkey session, PKCE, a Client ID Metadata Document), reads status with the `read` scope, proposes an Allow with the `propose` scope, and the proposal appears in Approvals, where a parent's tap carries it out and nothing happens without it.
2. Here: each AI feature runs against a mock model (AI SDK's test model) and its non-AI fallback; the gateway refuses in the right order (feature unknown, switched off, data level not allowed for the provider, model not allowed, monthly cap reached) and audits every call; keys are encrypted with AES-256-GCM and never leave the server.
3. Here: with every AI switch off, the whole gate still passes and no AI or MCP route answers beyond saying it is off.
4. On your phone, later: Claude reads status over MCP and proposes an Allow that Mum approves.

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | `packages/ai`: one gateway, `invoke(feature, input)`, on AI SDK 7.0.159. Checks in order, cheapest first: feature registered, global switch, feature switch, data level allowed for the provider, model on the allow-list, monthly cap. Refusals are typed results, never throws | Brightline's gateway pattern (reuse report 3) |
| 2 | Providers: Anthropic, OpenAI, Google (paid tier enforced: a key must be marked paid in Settings, or Google is refused), Mistral, Amazon Bedrock (Converse, `eu.` inference profiles, session credentials only), Ollama through the official OpenAI-compatible provider | Brief Part 13; no community packages |
| 3 | Keys: AES-256-GCM under the master key `init.sh` already makes (`secrets/master_key`). No master key, no AI: fail closed. Write-only in Settings, last four characters shown | Brief Part 8; reuse report |
| 4 | Feature registry: plain-English control (Level 1 plus the child's first name replaced by "Child A", proposes), job suggestions (Level 1, reads the weather through MCP), weekly summary (aggregates only, Level 1, template fallback). Each ships off, has a monthly cap in pence, and a non-AI fallback | Brief Part 13 |
| 5 | Data levels: 1 sent freely; 2 opt-in per feature with names replaced; 3 (photos, DNS logs, the child's Sunday answers) never leaves the server unless the provider is Ollama. The Settings screen shows each feature's level | Brief Part 13; the Phase 6 note on the week summary |
| 6 | Proposals: a new table; AI and MCP create rows, Approvals shows them as cards, and a parent's tap runs the existing control commands as that parent. The model's output is structured (Zod), and every argument is checked against the family's own services, groups and children before a card is shown | Brief Parts 13 and 22: AI only proposes |
| 7 | Untrusted content (domain names, MCP results, anything the child typed) goes into prompts as quoted data, never instructions, and a flow that reads it has no propose tool | Brief Part 13 |
| 8 | MCP server at `/mcp` on the main api (so behind Caddy), on `@modelcontextprotocol/server` 2.4.0, streamable HTTP only. Read tools: status, week, history, pending approvals. Propose tools: propose_override, propose_pause, propose_approval, each creating a proposal. Confirmation through the SDK's multi round-trip requests with signed, expiring request state. `Mcp-Method` and `Mcp-Name` headers checked against the body | Brief Part 13, MCP 2026-07-28 |
| 9 | OAuth 2.1, this platform as the authorisation server: metadata at `/.well-known/oauth-authorization-server` and the protected resource metadata, authorisation code with PKCE (S256 only), the parent signs in with their passkey session and consents on a screen in the app, Client ID Metadata Documents for clients, scopes `read` and `propose`, short-lived access tokens and rotating refresh tokens, all hashed at rest. The owner allows each client in Settings before it can be used | Brief Part 13 |
| 10 | MCP client for weather through `@ai-sdk/mcp` over HTTP; the owner adds the server and approves each tool; results are untrusted data | Brief Part 13 |
| 11 | Every AI call and refusal is audited (feature, provider, model, tokens, estimated cost, data levels); prompts and replies are not stored | Reuse report 3 |

## Dependencies

All in brief Part 17: `ai` 7.0.159, `@ai-sdk/anthropic` 4.0.94, `@ai-sdk/openai` 4.0.106, `@ai-sdk/google` 4.0.109, `@ai-sdk/mistral` 4.0.77, `@ai-sdk/amazon-bedrock` 5.0.130, `@ai-sdk/openai-compatible` 3.0.82 (for Ollama), `@ai-sdk/mcp` 2.0.88, `@modelcontextprotocol/server` and `@modelcontextprotocol/client` 2.4.0.

## Files

- `packages/ai` (new): gateway, providers, key crypto, feature registry, the three features with fallbacks, pseudonymising.
- `packages/db`: migration `0010`: AI settings and keys, AI calls, proposals, OAuth clients, codes and tokens, MCP servers. Additive only.
- `apps/api`: AI routes (owner settings, features), proposals in Approvals, the MCP server and OAuth endpoints.
- `apps/parent`: Settings, AI (owner): switches, keys, features and their data levels, MCP clients and servers; proposal cards on Approvals; the consent screen; plain-English control on Control and suggestions on Jobs when switched on.
- ADR 0016, `docs/setup/ai-and-mcp.md`, help topics.
