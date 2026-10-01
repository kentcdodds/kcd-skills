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
- A scoped Open API token with `local-execute` is available (or can be minted
  via MCP `api` / `tokenCreate`)
- The work does not _require_ the hosted cloud workerd

## Use hosted MCP `execute` when

- No Node / CLI on the machine
- The module must run in Kody's cloud workerd
- No token can be minted or provisioned (`KODY_API_TOKEN` missing and MCP `api`
  unavailable)

## Feature flags

Open API and local execute need `mcp-api-tool` and `local-execute` (experiments
cohort, or per-user opt-in on the docs page). Without them, token mint and
`--local` will not work.

## Mint a token

Call MCP `api` (or Open API) with:

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

## Run locally

```bash
npx @kodycodes/cli execute --local --token "$KODY_API_TOKEN" --code 'export default async function main() { return await kody.metaGetCurrentUser({}) }'
```

`--token` can be omitted when `KODY_API_TOKEN` is already in the environment.
`--file` works the same as `--code` for longer modules.

## Metering

Local CPU is not counted as `execute` or `dynamic_worker_day`. Capabilities
called through the proxy still meter normally.

## Cloud agents

Cursor cloud agents need `KODY_API_TOKEN` provisioned as a secret / env var in
the cloud environment before `--local` works. Prefer that over pasting tokens
into prompts. If the secret is missing and MCP `api` can mint one for the
session, mint, export into the shell, and do not echo it. If neither path is
available, fall back to hosted MCP `execute`.
