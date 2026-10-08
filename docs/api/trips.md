# Trip API

Trip endpoints use the standard `{ success, message, data }` envelope. Owned
operations require the authenticated TripBuddy session. Path identifiers are
MongoDB ObjectIds; request data is validated and lifecycle status is not
accepted in create/update payloads.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/v1/trips` | Create a draft. Fields may be incomplete. |
| GET | `/api/v1/trips/:tripId` | Read a trip subject to status and privacy rules. |
| PATCH | `/api/v1/trips/:tripId` | Edit an owned non-terminal trip. |
| DELETE | `/api/v1/trips/:tripId` | Delete an owned draft. |
| POST | `/api/v1/trips/:tripId/publish` | Validate all required fields and publish a draft. |
| POST | `/api/v1/trips/:tripId/cancel` | Explicitly cancel an owned non-completed trip. |
| POST | `/api/v1/trips/:tripId/status` | Advance only through the lifecycle transition graph. |
| POST | `/api/v1/trips/:tripId/images` | Upload up to eight trip images as multipart field `images`. |
| DELETE | `/api/v1/trips/:tripId/images/:imageIndex` | Remove an image from an owned draft. |
| GET | `/api/v1/users/me/trips` | List trips created by the current user. Supports `page`, `limit`, `status`. |

My trips response includes `items`, `page`, `limit`, `total`, `totalPages`,
`hasNextPage`, and `hasPreviousPage`. Page size is capped at 50.

## Data and lifecycle

A Trip references its `creator` (`User`) and `destination` (`Destination`).
Destination data is populated through an explicit safe projection; the
destination document is not copied into the Trip. `TripMember` is the
membership foundation. Creation writes an active `OWNER` membership for the
creator; later invite/join flows can add `MEMBER` entries.

Statuses are `DRAFT`, `PUBLISHED`, `PLANNING`, `CONFIRMED`, `ONGOING`,
`COMPLETED`, and `CANCELLED`. Create always saves `DRAFT`; update never changes
status. Publishing validates title, description, published destination, date
order and non-past start date, budget, group size, and privacy. The progression
is `PUBLISHED → PLANNING → CONFIRMED → ONGOING → COMPLETED`. Cancellation is a
separate operation and terminal. Ongoing/completed transitions are rejected
before the corresponding dates. Only owned drafts can be hard deleted.

## Privacy and permissions

- `PUBLIC`: published trips may be read without authentication.
- `COMMUNITY`: published trips require an authenticated account.
- `PRIVATE`: only the creator and active trip members can read.
- `INVITE_ONLY`: only the creator and pending/active invited members can read.

Drafts and cancelled trips are hidden from non-owners. Private failures are
returned as `TRIP_NOT_FOUND` to avoid disclosing their existence. Updates,
publish/cancel/status changes, image operations, and deletion verify creator
ownership in the service layer. Other membership actions are not implemented
in this phase.

## Validation and images

Drafts can omit destination, dates, budget, and title while the creator plans.
When supplied, destination IDs must resolve to a published destination; end
date must follow start date; budget bounds must be non-negative and ordered;
group size is an ordered positive range. Lists are trimmed and deduplicated.
The server revalidates every required publish field.

JPEG, PNG, and WEBP uploads are limited to 8 MB each and eight images per trip.
MIME and file signatures are both checked. Image bytes are uploaded to
Cloudinary, never MongoDB. The provider uses random generated asset IDs rather
than filenames from the client. `CLOUDINARY_URL` must be configured. Provider
public IDs are not included in trip API output.

## Errors

Common codes include `TRIP_NOT_FOUND`, `TRIP_ACCESS_DENIED`,
`INVALID_TRIP_ID`, `INVALID_TRIP_STATUS`, `TRIP_ALREADY_CANCELLED`,
`TRIP_VALIDATION_ERROR`, `DESTINATION_NOT_FOUND`, and image storage/upload
errors. Errors use the existing `HttpError` response convention.
