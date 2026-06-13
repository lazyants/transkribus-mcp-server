# transkribus-mcp-server

[![Tests](https://github.com/lazyants/transkribus-mcp-server/actions/workflows/test.yml/badge.svg)](https://github.com/lazyants/transkribus-mcp-server/actions/workflows/test.yml)

MCP server for the [Transkribus REST API](https://transkribus.eu/). Manage collections, documents, HTR/OCR recognition, models, and more through the Model Context Protocol.

**301 tools** across 22 resource domains, with 8 entry points so you can pick the right server for your MCP client's tool limit.

> **API scope:** This server covers the **legacy Transkribus TrpServer REST API**. The newer **Processing API v2** (OIDC auth, `/processing/v2`, `account.readcoop.eu`) is intentionally out of scope.

## Installation

```bash
npm install -g @lazyants/transkribus-mcp-server
```

Or run directly:

```bash
npx @lazyants/transkribus-mcp-server
```

## Configuration

Transkribus uses session-based authentication. You can authenticate in two ways:

### Option 1: Username + Password (auto-login)

```bash
export TRANSKRIBUS_USER=your-email@example.com
export TRANSKRIBUS_PASSWORD=your-password
```

The server will automatically log in and manage the session.

### Option 2: Direct session ID

```bash
export TRANSKRIBUS_SESSION_ID=your-session-id
```

Use this if you already have a valid session from the Transkribus platform.

## Entry Points

| Command | Domains | Tools |
|---|---|---|
| `transkribus-mcp-server` | All 22 domains | 301 |
| `transkribus-mcp-collections` | Auth, Collections (core/docs/pages/users/crowd/editdecl/credits/stats/labels/activity/tags) | 133 |
| `transkribus-mcp-admin` | Auth, Admin, Credits, Uploads, Labels, Files, System, Root | 63 |
| `transkribus-mcp-transcription` | Auth, Recognition, Layout Analysis, PyLaia, P2PaLA, DU | 48 |
| `transkribus-mcp-users` | Auth, Users, Crowdsourcing, eLearning | 30 |
| `transkribus-mcp-models` | Auth, Models | 27 |
| `transkribus-mcp-jobs` | Auth, Jobs, Actions | 19 |
| `transkribus-mcp-search` | Auth, Search, KWS | 17 |

Use split servers to reduce context size — pick only the splits you need.

## Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "transkribus": {
      "command": "npx",
      "args": ["-y", "@lazyants/transkribus-mcp-server"],
      "env": {
        "TRANSKRIBUS_USER": "your-email@example.com",
        "TRANSKRIBUS_PASSWORD": "your-password"
      }
    }
  }
}
```

Or use split servers (pick the splits you need):

```json
{
  "mcpServers": {
    "transkribus-collections": {
      "command": "npx",
      "args": ["-y", "-p", "@lazyants/transkribus-mcp-server", "transkribus-mcp-collections"],
      "env": {
        "TRANSKRIBUS_USER": "your-email@example.com",
        "TRANSKRIBUS_PASSWORD": "your-password"
      }
    },
    "transkribus-transcription": {
      "command": "npx",
      "args": ["-y", "-p", "@lazyants/transkribus-mcp-server", "transkribus-mcp-transcription"],
      "env": {
        "TRANSKRIBUS_USER": "your-email@example.com",
        "TRANSKRIBUS_PASSWORD": "your-password"
      }
    }
  }
}
```

## Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "transkribus": {
      "command": "npx",
      "args": ["-y", "@lazyants/transkribus-mcp-server"],
      "env": {
        "TRANSKRIBUS_USER": "your-email@example.com",
        "TRANSKRIBUS_PASSWORD": "your-password"
      }
    }
  }
}
```

## Security

- **Never commit your credentials** to version control
- Use environment variables or a `.env` file (excluded via `.gitignore`)
- Session IDs expire — prefer username/password for long-running setups

## Disclaimer

This is an unofficial MCP server for Transkribus. The authors are not affiliated with READ-COOP SCE. Use at your own risk.

## Releasing

Releases ship via the GitHub Release event. Maintainer flow:

1. Bump the version in `package.json` and `server.json` (`npm run check-versions` enforces alignment between `package.json#/version` and `server.json#/packages[0].version`).
2. Update `CHANGELOG.md`.
3. Commit, then `gh release create vX.Y.Z --notes-from-tag` (or write release notes inline).
4. The `Publish to npm + MCP Registry` workflow runs automatically: it `npm publish`es with provenance, polls the registry until the tarball is available, then pushes the matching `server.json` to the MCP Registry via `mcp-publisher`.

The workflow skips `npm publish` cleanly if the version is already on npm (cutover guard for releases that were partially published manually).

### npm authentication

Publishing uses **npm Trusted Publishing**: the workflow's GitHub OIDC token (`id-token: write`) is exchanged for a one-shot publish token at runtime. No `NPM_TOKEN` secret needs to live in the repo.

The binding is configured in the npm web UI (package → Trusted Publishers): provider `GitHub Actions`, organization `lazyants`, repository `transkribus-mcp-server`, workflow `publish-registry.yml`.

## License

[FSL-1.1-MIT](LICENSE) — see [LICENSE](LICENSE) for the full terms. Versions `1.x` remain MIT-licensed.
