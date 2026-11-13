#!/usr/bin/env bash
# Build, pack and install the release tarball the way a user gets it, list its
# tools over stdio, then drive the three tools changed in 4.2.0 against a local
# capturing proxy. No request reaches Transkribus. Run from the repository root.
set -euo pipefail
export GIT_PAGER=cat PAGER=cat npm_config_fund=false npm_config_audit=false

VERSION="$(node -p 'require("./package.json").version')"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "== build $VERSION"
npm run build --silent
echo "== pack"
TGZ="$(npm pack --silent --pack-destination "$TMP")"
echo "$TGZ"
echo "== install tarball into a clean project"
(cd "$TMP" && npm init -y >/dev/null && npm install --silent "./$TGZ" </dev/null)
echo "installed: $(node -p "require('$TMP/node_modules/@lazyants/transkribus-mcp-server/package.json').version")"
echo "sdk: $(node -p "require('$TMP/node_modules/@modelcontextprotocol/sdk/package.json').version")  zod: $(node -p "require('$TMP/node_modules/zod/package.json').version")"
echo "== tools/list over stdio"
node docs/_attachments/release-4.1.1/smoke-packed.mjs "$TMP/node_modules/.bin/transkribus-mcp-server" "$VERSION" 305
echo "== changed tools over stdio, against a local capturing proxy"
node docs/_attachments/release-4.2.0/smoke-wire.mjs "$TMP/node_modules/.bin/transkribus-mcp-server" "$TMP" < /dev/null
