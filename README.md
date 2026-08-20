# transkribus-mcp-server

[![Tests](https://github.com/lazyants/transkribus-mcp-server/actions/workflows/test.yml/badge.svg)](https://github.com/lazyants/transkribus-mcp-server/actions/workflows/test.yml)

MCP server for the [Transkribus REST API](https://transkribus.eu/). Manage collections, documents, HTR/OCR recognition, models, and more through the Model Context Protocol.

**300 tools** across 22 resource domains, with 8 entry points so you can pick the right server for your MCP client's tool limit.

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
| `transkribus-mcp-server` | All 22 domains | 300 |
| `transkribus-mcp-collections` | Auth, Collections (core/docs/pages/users/crowd/editdecl/credits/stats/labels/activity/tags) | 132 |
| `transkribus-mcp-admin` | Auth, Admin, Credits, Uploads, Labels, Files, System, Root | 62 |
| `transkribus-mcp-transcription` | Auth, Recognition, Layout Analysis, PyLaia, P2PaLA, DU | 47 |
| `transkribus-mcp-users` | Auth, Users, Crowdsourcing, eLearning | 29 |
| `transkribus-mcp-models` | Auth, Models | 26 |
| `transkribus-mcp-jobs` | Auth, Jobs, Actions | 18 |
| `transkribus-mcp-search` | Auth, Search, KWS | 16 |

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

1. Bump the version in `package.json`, `package-lock.json`, and `server.json` (`npm version <x.y.z> --no-git-tag-version` updates the first two together). `npm run check-versions` **hard-fails** unless `package.json#/version` and `server.json#/packages[0].version` agree. `server.json#/version` is checked loosely: it must be present, and it only fails when it *regresses* below `packages[0].version` — a value left behind at the previous release passes with a `WARN:` line and exit 0. The script does **not** look at `package-lock.json` or `CHANGELOG.md` at all, so read its output rather than trusting its exit code.
2. Update `CHANGELOG.md`.
3. Commit, and **merge the version bump to `main` before creating the release**. Then create the tag yourself, on a SHA you have checked, and only then create the release from it:

   ```bash
   V=X.Y.Z && PR=<release-pr-number> &&
     SHA="$(gh pr view "$PR" --json mergeCommit -q .mergeCommit.oid)" && test -n "$SHA" &&
     git fetch origin main && git merge-base --is-ancestor "$SHA" origin/main &&
     PKG="$(git show "$SHA:package.json")" &&
     test "$(printf '%s' "$PKG" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).version')" = "$V" &&
     CL="$(git show "$SHA:CHANGELOG.md")" &&
     printf '%s\n' "$CL" | awk -v v="$V" 'index($0,"## ["v"]")==1{f=1;next} /^## \[/{f=0} /^\[[0-9]+\.[0-9]+\.[0-9]+\]:/{f=0} f' > "/tmp/notes-v$V.md" &&
     grep -q '[^[:space:]]' "/tmp/notes-v$V.md" &&
     git tag -a "v$V" "$SHA" -m "v$V" &&
     git push origin "v$V" &&
     gh release create "v$V" --verify-tag --notes-file "/tmp/notes-v$V.md"
   ```

   **The failure this prevents:** with no existing tag, `gh release create vX.Y.Z` places one on the **tip of the default branch**. Run it while the bump is still on a release branch and it tags the *previous* release's commit; the workflow then publishes whatever version it finds in that commit's `package.json`, producing a `vX.Y.Z` GitHub Release that silently republishes the old version. Nothing downstream catches it — neither the workflow nor `check-versions` compares the tag against the version files — which is why the sequence above has to.

   Each element is load-bearing:

   - **`gh pr view … .mergeCommit.oid`** names the release PR's own squash commit. Do not substitute `git rev-parse origin/main`: that is merely whatever sits on `main` at the moment you look, so an unrelated merge landing in the gap gets tagged and shipped instead. `gh` exits 0 and prints nothing for an unmerged PR, hence the explicit `test -n`.
   - **The `&&` chain** stops at the first failure instead of falling through to the irreversible step. Both `git show` calls are assigned to a variable rather than piped directly, so their exit status is actually checked — a pipeline reports only its *last* command's status unless `pipefail` is set, which is not assumed here.
   - **`git merge-base --is-ancestor`** proves the commit is reachable from `main`. Mere existence is not enough: a commit can be present locally because another branch was fetched, and if its version files happen to match it would otherwise pass every remaining check.
   - **The version test reads `package.json` out of the target commit**, not the working tree — which would still show the right version while `$SHA` pointed elsewhere.
   - **The `awk`** lifts that version's section out of the commit's `CHANGELOG.md` for `--notes-file`. Without it the release body is whatever `--notes-from-tag` finds in the annotation — here the literal string `vX.Y.Z`, a poor release note for any version and a misleading one for a release carrying a breaking change. It stops at the next `## [` heading *or* at the first link-reference definition, because the oldest entry has no heading after it and would otherwise swallow the whole link-reference block. `grep -q` rather than `test -s` guards the result: a section empty apart from its blank line still produces a one-byte file, which `test -s` accepts.
   - **`--verify-tag`** makes `gh` abort rather than invent a tag if the push did not land — the guard against the tip-of-default-branch fallback described above.

   If `gh release create` fails after the tag is already pushed, do not rerun the whole block; it will stop at `git tag`, which is correct. Rerun only the final command.
4. The `Publish to npm + MCP Registry` workflow runs automatically: it `npm publish`es with provenance, polls the registry until the tarball is available, then pushes the matching `server.json` to the MCP Registry via `mcp-publisher`.

The workflow skips `npm publish` cleanly if the version is already on npm (cutover guard for releases that were partially published manually).

### npm authentication

Publishing uses **npm Trusted Publishing**: the workflow's GitHub OIDC token (`id-token: write`) is exchanged for a one-shot publish token at runtime. No `NPM_TOKEN` secret needs to live in the repo.

The binding is configured in the npm web UI (package → Trusted Publishers): provider `GitHub Actions`, organization `lazyants`, repository `transkribus-mcp-server`, workflow `publish-registry.yml`.

## License

[FSL-1.1-MIT](LICENSE) — see [LICENSE](LICENSE) for the full terms. Versions `1.x` remain MIT-licensed.
