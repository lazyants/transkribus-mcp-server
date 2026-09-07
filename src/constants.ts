export const TRANSKRIBUS_API_BASE = 'https://transkribus.eu/TrpServer/rest';
export const MAX_RETRIES = 3;
export const REQUEST_TIMEOUT = 60_000;

// Transkribus Metagrapho ("Processing") API — a SEPARATE service from the legacy
// TrpServer REST API above, with its own base URL, its own OIDC bearer-token auth,
// and its own client in services/metagrapho.ts.
//
// The version is `v1` and was verified against the live service, not taken from
// vendor prose: `GET /processing/v1/processes` answers 401 (exists, auth required)
// while `/processing/v2` and `/processing/v3` answer 404, and
// https://transkribus.eu/processing/v1/openapi.json self-describes as
// "Transkribus Metagrapho API" 1.13.1 with `servers: [https://transkribus.eu/processing/v1]`.
// Some vendor marketing snippets still show a `/processing/v2` URL and a
// `config.modelId` field; both are wrong against the live service, which requires
// `config.textRecognition.htrId`. Re-probe before changing this constant.
export const METAGRAPHO_API_BASE = 'https://transkribus.eu/processing/v1';

// READCOOP SSO (Keycloak). The password and refresh grants against this endpoint are
// the vendor's own documented headless path — an MCP server on stdio cannot run the
// authorization-code flow the OpenAPI document advertises, because there is no browser
// and no redirect URI.
export const READCOOP_TOKEN_URL =
  'https://account.readcoop.eu/auth/realms/readcoop/protocol/openid-connect/token';

// Public Keycloak client id documented for this API. Verified as a real, grant-enabled
// client: a password grant with bogus credentials returns `invalid_grant`, whereas a
// made-up client id returns `invalid_client`.
export const METAGRAPHO_CLIENT_ID = 'processing-api-client';

// Refresh this many milliseconds before the token's stated expiry, so a request is not
// sent with a token that expires in flight.
export const TOKEN_EXPIRY_SKEW_MS = 30_000;
