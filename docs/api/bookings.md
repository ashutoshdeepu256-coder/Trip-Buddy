# Travel services and bookings API

All paths are relative to `/api/v1`. Every endpoint requires an authenticated session and uses the normal success/error response envelope. There is no configured travel booking provider or payment provider in this application.

## Discovery

- `GET /bookings/categories` lists accommodation, transport, and activities.
- `GET /bookings/services?category=ACCOMMODATION` lists available handoff types and their capability flags.
- `GET /bookings/services/:serviceId` returns one service description.

The directory currently points to Google Travel hotel and flight search pages and Google Maps activity/place search. These are external search handoffs only. TripBuddy does not search inventory, check availability, return provider pricing, reserve, cancel with a provider, or process refunds. The supported providers require no TripBuddy credentials; handoffs use a fixed HTTPS Google domain and destination encoded as search input.

## Private booking records

- `POST /bookings` creates a user-owned record. Supply an `Idempotency-Key` header (8–64 letters, digits, underscores, or hyphens). The body requires `serviceId`, `mode` (`USER_RECORDED` or `EXTERNAL_HANDOFF`), `serviceName`, `destination`, `startDate`, `endDate`, and `travellers`. `tripId`, `itineraryId`, `travellerNote`, and a `userEstimate` `{ amount, currency }` are optional. A user estimate is explicitly labelled as the user's own estimate; it is never a provider quote. External handoffs cannot include an estimate.
- `GET /bookings?page=1&limit=20&status=USER_RECORDED` lists only the caller's records. Page size is capped at 50.
- `GET /bookings/:bookingId` retrieves only the caller's record.
- `PATCH /bookings/:bookingId` updates only `travellerNote`.
- `POST /bookings/:bookingId/cancel` cancels the TripBuddy record. For a previous external handoff, the external provider must be contacted separately to manage any reservation made there.

The unique owner/idempotency-key index makes repeated submissions return the original record. Trip association requires trip ownership or active trip membership, while itinerary association requires private itinerary ownership and a matching Trip when both IDs are supplied. Association does not make private booking details visible to trip members or itinerary collaborators. Public Trip and shared itinerary APIs never include bookings.

## States and privacy

`USER_RECORDED` means the user saved a private request. `EXTERNAL_HANDOFF` means TripBuddy prepared a safe external search URL; it does not prove the user followed it or booked anything. `CANCELLED` means only the TripBuddy record was cancelled. There is no provider-confirmed, failed, refunded, or provider-cancellation state because no verified provider workflow exists. Payment status is not represented.

Only the owner can read a record, including its note, estimate, dates, traveller count, and URL. Passport, payment-card, and unnecessary sensitive identity data are not accepted. Meaningful create, update, and cancellation actions create audit events. Callback routes are not exposed because no real provider callback integration is configured.
