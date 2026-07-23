# Member authentication

Foundr1 Members uses first-party email/password authentication backed by Neon. Clerk is not part of the runtime.

## Customer flow

1. A first-time member enters an email address.
2. Foundr1 sends a six-digit verification code through Resend. The code expires after 10 minutes.
3. After verification, the member sets a password and is signed in.
4. Later visits use email and password without another email code.
5. The same verification flow can reset a forgotten password.

An existing member is linked by normalized email, so orders, points, coupons, and the shared member number remain attached to the same member record.

## Sessions

- The browser receives an opaque, `HttpOnly`, `SameSite=Lax` cookie.
- Only a SHA-256 hash of the session token is stored in `member_sessions`.
- A session expires one year after login.
- Members can remain signed in on multiple devices. Signing out revokes only the current session.
- Passwords are hashed with Node.js `scrypt` using a random per-password salt.

## Protection

- Verification codes are HMAC-hashed with `AUTH_SECRET`; plaintext codes are not stored.
- Codes expire after 10 minutes and allow at most five attempts.
- Verification requests and failed password logins are rate-limited by email and request IP.
- Authentication responses do not reveal whether an email is already registered.

## Required production configuration

- `DATABASE_URL`
- `AUTH_SECRET` (recommended as a dedicated secret; `DATABASE_URL` is used as the existing server-side fallback)
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`

Apply the authentication tables from `db/schema.sql` with `npm run db:push`.
