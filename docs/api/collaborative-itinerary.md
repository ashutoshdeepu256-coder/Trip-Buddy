# Collaborative itinerary API

All endpoints use the existing authenticated `/api/v1/itineraries` API and the standard `{ success, message, data }` response envelope. Writes require `expectedRevision`; successful writes return `{ itinerary, revision, duplicate }`. Retries with the same actor, itinerary, operation, expected revision, and request contents return the latest itinerary with `duplicate: true` and do not create a second change. A stale, different write returns HTTP 409 with code `REVISION_CONFLICT` and `error.details.latestRevision` plus the latest serialized itinerary. Clients should reload or reconcile before retrying.

## Authorization

Standalone itineraries remain owner-only. Collaboration can be enabled only for a Trip-linked itinerary by its Trip creator or an administrator. A shared reader must have an active account, an `ACTIVE` TripMember record, and an explicit itinerary grant. `VIEWER` can read and inspect history; `EDITOR` can edit; the Trip creator or administrator can manage grants. An accepted connection, public Trip, recommendation, or chat room does not confer access. A removed member or revoked grant fails the next REST request and the next socket authorization check.

## Routes

| Method and path | Purpose |
| --- | --- |
| `GET /itineraries/shared` | List shared itineraries currently available to the signed-in active Trip member |
| `GET /itineraries/:itineraryId/shared` | Read shared itinerary, role, and revision |
| `PUT /itineraries/:itineraryId/collaboration` | Enable or disable collaboration with `{ enabled, expectedRevision }` |
| `GET /itineraries/:itineraryId/collaborators` | List active, eligible collaborators and their roles (authorized collaborator or manager) |
| `PUT /itineraries/:itineraryId/collaborators` | Grant/change role with `{ userId, role, expectedRevision }`, where role is `VIEWER` or `EDITOR` |
| `DELETE /itineraries/:itineraryId/collaborators` | Revoke with `{ userId, expectedRevision }` |
| `POST /itineraries/:itineraryId/activities` | Add an activity using `{ expectedRevision, dayId, section, activity }` |
| `PATCH /itineraries/:itineraryId/activities/:activityId` | Edit an activity using the same body |
| `DELETE /itineraries/:itineraryId/activities/:activityId` | Remove with `{ expectedRevision, dayId, section }` |
| `PUT /itineraries/:itineraryId/activities/order` | Reorder a section using `{ expectedRevision, dayId, section, activityIds }` |
| `PUT /itineraries/:itineraryId/days/order` | Reorder days using `{ expectedRevision, dayIds }` |
| `POST /itineraries/:itineraryId/days` | Append a day using `{ expectedRevision }` (up to 31 days) |
| `PATCH /itineraries/:itineraryId/days/:dayId` | Set day title with `{ expectedRevision, dayId, title }` |
| `DELETE /itineraries/:itineraryId/days/:dayId` | Remove a day with `{ expectedRevision, dayId }`; dates are compacted, and one day must remain |
| `GET /itineraries/:itineraryId/history?page=1&limit=20` | Read paginated, content-free change history |
| `POST /itineraries/:itineraryId/restore` | Restore `{ revision, expectedRevision }` as a new revision |

Activities accept `title` (1–120 chars), `description` (0–500), `durationMinutes` (15–720, with a 600-minute daily total), `estimatedCost` (nullable nonnegative amount and three-letter currency), and `location` (0–160). A section supports at most five activities. Day and activity IDs are stable ObjectId strings. Activity and daily budget summaries are recalculated after edits.

## Socket.IO

Join and leave with `itinerary:join` / `itinerary:leave` and `{ itineraryId }`. Supported write events are `itinerary:activity:add`, `itinerary:activity:update`, `itinerary:activity:remove`, `itinerary:activities:reorder`, `itinerary:days:reorder`, `itinerary:day:add`, `itinerary:day:update`, and `itinerary:day:remove`. They carry `itineraryId` and the same REST body fields (update/remove also carry their resource ID). Use acknowledgements for the standard `{ success, data }` or `{ success: false, error }` response. After a committed write, authorized room members receive `itinerary:changed` with only itinerary ID, revision, operation name, and actor ID. Every join, write, and delivery rechecks current authorization; chat membership is not consulted.

The server currently uses Socket.IO's in-process adapter. Multiple server instances require a shared Socket.IO adapter (for example, Redis) to synchronize rooms and broadcasts.
