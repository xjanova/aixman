# Mobile API (bearer auth for the X-DREAMER Android app)

The web app authenticates with a NextAuth session cookie. A native client has no
cookie jar we control and cannot complete NextAuth's CSRF flow, so it presents
`Authorization: Bearer <access token>` instead.

**No endpoint was duplicated for mobile.** `getCurrentUserId()` and `isAdmin()`
in `src/lib/auth.ts` now resolve the caller from *either* credential, so every
existing route — `/api/generate`, `/api/gallery`, `/api/credits`, `/api/upscale`,
`/api/favorites`, `/api/referral` — works for mobile unchanged. Only three new
routes exist, and they exist because password login and token refresh have no
cookie-free equivalent.

## Endpoints

### `POST /api/mobile/auth/login`

```jsonc
// request
{ "email": "user@example.com", "password": "..." }

// 200
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "expiresIn": 3600,          // seconds
  "refreshExpiresIn": 2592000,
  "tokenType": "Bearer",
  "user":    { "id": 1, "name": "...", "email": "...", "avatar": null, "role": "user" },
  "credits": { "balance": 1280, "totalBought": 0, "totalUsed": 3420, "totalBonus": 150 }
}
```

| Status | Meaning |
|---|---|
| 400 | missing email or password |
| 401 | wrong credentials — one generic Thai message, never says which field |
| 403 | account disabled (only reachable with a correct password) |
| 429 | rate limited; `Retry-After` header in seconds |

### `POST /api/mobile/auth/refresh`

`{ "refreshToken": "..." }` → same shape as login. The refresh token is
**rotated** on every call. A 401 means the client must clear its tokens and show
the login screen.

### `GET /api/mobile/me`

Profile + credit balance in one call for cold start. Accepts either credential.

## Registration

There is none here on purpose. `users` is owned by xmanstudio (Laravel) — the
app sends new users to `https://xman4289.com/register` in a browser and then
back to login.

## Security notes

- **Two token kinds, one secret.** Both are HS256 JWTs signed with a key derived
  from `AUTH_SECRET`/`NEXTAUTH_SECRET` plus a `:mobile-v1` suffix, so a mobile
  token and a NextAuth session token can never be replayed as each other. The
  `knd` claim is verified, so a 30-day refresh token cannot be used as an access
  token. `algorithms: ['HS256']` is pinned against `alg: none`.
- **Revocation.** Tokens are stateless, but `getCurrentUserId()` re-reads
  `users.is_active` from the DB on *every* request — disabling an account in
  xmanstudio cuts off the phone immediately. Per-device sign-out would need an
  `ai_mobile_tokens` table; see the note at the bottom of `src/lib/mobile-auth.ts`.
- **User enumeration.** A missing email still burns a real bcrypt compare
  against a decoy hash, so response time does not reveal which addresses have
  accounts.
- **Rate limiting** (`src/lib/rate-limit.ts`): 20 login attempts per IP and 10
  per email per 15 minutes, 60 refreshes per IP. A successful login clears both
  counters. Client IP is taken from the *last* `x-forwarded-for` hop — the one
  nginx observed and a client cannot forge. The limiter is in-process, which is
  correct while `ecosystem.config.cjs` runs `instances: 1`; move it to Redis
  before enabling cluster mode.
- **No CORS headers were added.** A native client is not subject to CORS, and
  opening `/api/*` to browsers on other origins would widen the attack surface
  for nothing. If a mobile *web* build is ever needed, add an explicit origin
  allowlist rather than `*`.
- Tokens must only ever travel over HTTPS. The app pins its base URL to
  `https://ai.xman4289.com` and refuses cleartext except for an explicit
  localhost dev override.

## Env

No new variables. `AUTH_SECRET` (or the existing `NEXTAUTH_SECRET`) must be set —
issuing a token throws loudly if it is missing rather than falling back to a
default.
