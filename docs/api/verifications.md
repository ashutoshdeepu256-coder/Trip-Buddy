# Verification API

All routes use the `/api/v1` prefix. User routes require the `tripbuddy_session`
HTTP-only cookie. Authenticated routes may also accept a bearer token for
non-browser clients. Verification statuses are always determined by the server.

## Email

| Method | Path | Authentication | Behavior |
| --- | --- | --- | --- |
| POST | `/auth/resend-verification-email` | Required | Creates a single-use token expiring after 30 minutes. Resend is rate-limited. |
| POST | `/auth/verify-email` | Public, token required | Consumes the hashed token once and marks the account email verified. |

Delivery links open the public client route `/verify-email?token=...`; the
client posts the token to the API and then removes it from the URL.

Tokens are generated with cryptographic randomness and stored only as SHA-256
hashes. Configure `EMAIL_PROVIDER_WEBHOOK_URL` and optionally
`EMAIL_PROVIDER_API_KEY` to send through an HTTPS delivery adapter. Without a
provider, the API returns a development token only when `NODE_ENV` is not
`production` and `ALLOW_DEV_VERIFICATION_CODES=true`; production requests fail
with `503 DELIVERY_NOT_CONFIGURED`. Do not enable development codes in a
production environment.

## Phone

| Method | Path | Authentication | Behavior |
| --- | --- | --- | --- |
| GET | `/verifications/me` | Required | Returns the caller's email, phone, and identity status only. |
| GET | `/verifications/history` | Required | Returns safe status/timestamp history; no secrets or review notes. |
| POST | `/verifications/phone/send-otp` | Required | Accepts `{ "phone": "+14155552671" }`; 5-minute expiration and 60-second resend cooldown. |
| POST | `/verifications/phone/verify-otp` | Required | Accepts `{ "code": "123456" }`; maximum five attempts per code. |

OTP values are generated using a cryptographic random number generator, salted
and HMACed with the verification secret before persistence, and removed after
success or expiry. The server limits each account to five code sends per hour
in addition to route-level IP rate limits. Configure
`PHONE_OTP_PROVIDER_WEBHOOK_URL` and optionally `PHONE_OTP_PROVIDER_API_KEY`.
Otherwise development codes are available only with the explicit development
flag; production requests fail closed. The phone number is stored in a
non-selected field and is omitted from public profile responses.

## Identity review

| Method | Path | Authentication | Behavior |
| --- | --- | --- | --- |
| POST | `/verifications/identity` | Required | Creates one pending manual-review request. |
| GET | `/verifications/identity/status` | Required | Returns the caller's identity status. |
| POST | `/verifications/identity/document` | Required | Uploads one PDF/PNG/JPEG (max 5 MiB) to authenticated private storage. |
| GET | `/admin/verifications` | Moderator/Admin | Lists verification records with optional status/type and pagination filters. |
| GET | `/admin/verifications/:id` | Moderator/Admin | Gets review details. |
| GET | `/admin/verifications/:id/document` | Moderator/Admin | Streams the private document through the API; it does not return a public URL. |
| POST | `/admin/verifications/:id/approve` | Moderator/Admin | Approves a pending identity request with notes. |
| POST | `/admin/verifications/:id/reject` | Moderator/Admin | Rejects a pending identity request with notes. |
| POST | `/admin/verifications/:id/revoke` | Moderator/Admin | Revokes a verified record. |

Identity documents are not stored in MongoDB. Uploads require `CLOUDINARY_URL`
and use authenticated Cloudinary assets. Approval is rejected until a document
has been securely uploaded. Review notes, provider references, and document
asset identifiers are excluded from ordinary query results. A reviewer cannot
approve their own request. Admin roles are assigned only by a trusted operator;
public registration cannot set a role.

## Authentication and profiles

`POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, and `GET
/auth/me` provide the initial account/session foundation. Passwords are hashed
with bcrypt; session cookies are HTTP-only, `SameSite=Lax`, and `Secure` in
production. Logout increments a persisted token version to invalidate issued
sessions. `GET/PATCH /users/me` manage a private profile; `GET /users/:userId`
returns a public projection containing the traveler's name, bio, city, country,
and factual verification/trip/review signals. Private travel preferences,
availability, budget ranges, and excluded destinations are not included.

Configure a unique random `JWT_SECRET` with at least 32 characters. Do not
commit `.env` files. `CLIENT_URL` must name the single trusted browser origin.
