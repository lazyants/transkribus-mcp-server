# transkribus-mcp-server

[![Tests](https://github.com/lazyants/transkribus-mcp-server/actions/workflows/test.yml/badge.svg)](https://github.com/lazyants/transkribus-mcp-server/actions/workflows/test.yml)

MCP server for the [Transkribus REST API](https://transkribus.eu/). Manage collections, documents, HTR/OCR recognition, models, and more through the Model Context Protocol.

**301 tools** across 22 resource domains, with 8 entry points so you can pick the right server for your MCP client's tool limit.

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

## License

MIT — see [LICENSE](LICENSE) for details.
