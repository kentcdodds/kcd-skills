---
name: prefer-local-kody-execute
description: >
  Prefer @kodycodes/cli execute --local over hosted MCP execute when the agent
  has shell + Node. Use when running Kody execute / calling Kody from an agent
  that can run local commands.
---

# Prefer local Kody execute

Default: run execute modules on the agent machine with
`@kodycodes/cli execute --local`. Hosted MCP `execute` is the fallback.

Public docs: https://kody.codes/docs/open-api

## Prefer local when

- Node.js ≥ 22 is available
- `@kodycodes/cli` can be run (`npx` is fine)
- Auth is available via `kody login` and/or `KODY_API_TOKEN` (see below)
- The work does not _require_ the hosted cloud workerd

## Auth for `--local`

Priority:

1. `--token` / `KODY_API_TOKEN` (scoped `kody_at_…`) when set — typical for CI
   and Cloud Agents
2. Else the stored CLI MCP OAuth access token from `kody login` (no
   under-the-hood `tokenCreate`) — default for interactive agents
3. Else a clear “login or provide a token” error

After `kody login`, skip minting a temporary API token for local execute.
CapabilityProxy and package-graph accept that OAuth Bearer when the
`local-execute` flag is on.

## Use hosted MCP `execute` when

- No Node / CLI on the machine
- The module must run in Kody's cloud workerd
- Neither login nor a token is available (`kody login` not possible and
  `KODY_API_TOKEN` missing)

## Feature flags

Open API and local execute need `mcp-api-tool` and `local-execute` (experiments
cohort, or per-user opt-in on the docs page). Without them, `--local` will not
work.

## Run locally (default)

```bash
kody login   # once, if not already logged in
npx @kodycodes/cli execute --local --code 'export default async function main() { return await kody.metaGetCurrentUser({}) }'
```

Omit `--token` when using login OAuth. Prefer `KODY_API_TOKEN` in the
environment over `--token` when a scoped token is already set, so the secret is
not visible in process arguments. `--file` works the same as `--code` for longer
modules.

## Mint a token (CI / headless only)

Only when interactive `kody login` is not available (CI, Cloud Agents without a
provisioned secret, other headless hosts). Call MCP `api` (or Open API) with:

```json
{
	"operationId": "tokenCreate",
	"params": {
		"name": "kody-cli",
		"scopes": ["local-execute", "account:read"]
	}
}
```

Add other scopes the module needs (for example `packages:read`). The token value
is returned once. Store it as `KODY_API_TOKEN` or pass `--token`. **Never paste
the token into chat.**

Revoke with MCP `api` `tokenRevoke` when done with a short-lived token.

## Metering

Local CPU is not counted as `execute` or `dynamic_worker_day`. Capabilities
called through the proxy still meter normally.

## Cloud agents

Prefer a provisioned `KODY_API_TOKEN` secret / env var in the cloud environment
before `--local` works. Do not treat interactive mint as the first path for
desktop agents — those should use `kody login` + `execute --local` (omit
`--token`). If the cloud secret is missing and MCP `api` can mint one for the
session, mint, export into the shell, and do not echo it. If neither path is
available, fall back to hosted MCP `execute`.
