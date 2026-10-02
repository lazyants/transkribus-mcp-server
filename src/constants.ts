export const TRANSKRIBUS_API_BASE = 'https://transkribus.eu/TrpServer/rest';
export const MAX_RETRIES = 3;
export const REQUEST_TIMEOUT = 60_000;

// Transkribus Metagrapho ("Processing") API — a SEPARATE service from the legacy
// TrpServer REST API above, with its own base URL, its own OIDC bearer-token auth,
// and its own client in services/metagrapho.ts.
//
// v1 remains the default. The Developer Platform v2 beta OpenAPI publishes the
// staging host below (verified 2026-10-02), not /processing/v2 on transkribus.eu.
export const METAGRAPHO_API_BASE = 'https://transkribus.eu/processing/v1';
export const PROCESSING_V2_API_BASE = 'https://api-staging.transkribus.org/v2';
export const PROCESSING_LONGPOLL_TIMEOUT_MS = 45_000;
export const PROCESSING_ZIP_MAX_BYTES = 20 * 1024 * 1024;

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
