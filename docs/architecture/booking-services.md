# Travel services and booking architecture

Phase 17 adds one `Booking` collection and an adapter-shaped service directory. It does not duplicate Trips, Itineraries, Destinations, or payments. The directory is static metadata for external handoffs; it is not live inventory.

## Provider capability matrix

| Provider | Categories | Search | Availability / pricing | Reservation / cancellation / refunds | Credentials |
| --- | --- | --- | --- | --- | --- |
| Google Travel search handoff | Accommodation, transport | External browser search only | No | No | None |
| Google Maps search handoff | Activities and attractions | External browser search only | No | No | None |

These handoffs use fixed HTTPS destinations on `www.google.com`, with user-entered destination encoded into the query/path. TripBuddy does not scrape provider pages or send user booking notes. There are no provider APIs, provider rate limits, provider timeouts, callbacks, data-retention agreements, or upstream errors to configure. TripBuddy API writes are authenticated, rate limited, bounded, and provider-independent. `BookingProviders` is the seam for a future verified integration; it must not report reservation, cancellation, pricing, or refund success until a trusted provider response supports it.

## Model and state transitions

`Booking` stores its owner, optional Trip and Itinerary references, service category/provider, bounded service/destination metadata, generated external URL, dates, traveller count, optional user-authored estimate, private traveller note, status history, idempotency key, and timestamps. Indexes support owner history, trip/status/date lookup, status/date lookup, provider lookup, and unique owner/idempotency key. No provider reference or confirmation code is stored because none exists.

```text
create request -> USER_RECORDED -> CANCELLED
create handoff -> EXTERNAL_HANDOFF -> CANCELLED
```

Cancellation changes only the TripBuddy record. There is no transition to confirmed, failed, or refunded. Payment state is separate and absent. Itinerary contents are never changed by booking mutations.

## Authorization and operations

All booking APIs require authentication. Records are always queried by owner. Trip association requires trip creator or active membership, and private itinerary association requires itinerary owner. Those association checks do not grant record visibility to collaborators or trip members. Strict Zod schemas reject client statuses, prices presented as provider quotes, references, confirmation codes, and arbitrary URLs. External URLs are generated from the fixed catalog and revalidated by the client before opening. Writes have a per-user rate limit and create idempotency key; callbacks are omitted until a real signed provider workflow exists. Audit metadata contains state/category identifiers only, not notes, full URLs, estimates, or personal booking details.

No card data is collected. The current user estimate is a planning annotation with a `USER_ESTIMATE` source label and is not a quote. New providers must document capabilities, credentials, attribution, data retention, request limits, timeouts, error mapping, signatures, idempotency, cancellation/refund handling, and verified sandbox coverage before adding confirmed booking states.
