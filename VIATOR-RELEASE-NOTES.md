# Viator booking links — PWA v64

Prepared on 23 September 2026, separately from submitted iOS 1.0.7 (build 7).
This source update does not change that Apple binary or its review state.

The catalogue has 5,429 stored adventures, 5,412 active and 17 paused. Seventy-one
distinct, quality-checked Viator discoveries were added as adventures, including
25 genuine hidden gems. One original proposal was excluded for an activity
mismatch. The owner removed the forced 20% quota; no filler or duplicate
activity at a specific place was intentionally added.

All 5,412 active adventures have dated targeted production API search records.
The registry contains 1,005 individually verified adventure matches, 931 ACTIVE
products and 136 countries/territories. Product-page or full-product API itinerary
review establishes the activity match; a separate API status check rejects
inactive products. All 931 matched products also have a current or future booking
schedule; this does not guarantee capacity on a chosen date. Search snippets
alone are insufficient. Eighty researched adventure links were excluded after
their 61 products were inactive or unavailable through the API.

This is not a complete yes/no determination: 3,957 adventures still have
first-page candidates needing review, 436 have unfiltered fallback candidates,
and 14 have unresolved inactive-product gaps. Search results cannot establish
permanent absence.
Searches use the named place, retry activity wording on zero results, and filter
by destination country where mapped. Viator returned at most 24 results per
query; 3,047 entries have more results beyond that page. No whole Viator
inventory was ingested. Unmatched adventures have no booking button.

## Behaviour

- Only individually reviewed ACTIVE products receive links. No generic search
  buttons or guessed product IDs.
- Links appear below Maps / Add to shortlist, with provider name, relevant tour
  conditions and commission disclosure. Combination tours may be longer than the
  adventure itself. Customers must check options, departure city, admission,
  suitability and date availability.
- Locked gems, paused adventures and do-not-travel country advisories suppress
  links. Changing the adventure title or place invalidates its pinned match.
- Attribution uses Viator's unchanged API product URL with public partner ID
  P00321485. No Wayfinder account ID, email, progress, location or photo is appended. No
  Viator script, pixel or private API credential ships in the client.
- Catalogue/link assets remain public offline assets. Purchase gating controls
  the UI; it is not encryption of the content files.
- Tours are physical services booked externally. Digital gem purchases retain
  the existing Apple/RevenueCat purchase path.

## Account and release state

The owner authorised the API licence and credential creation, verified their
partner email, and production API requests succeeded. Sandbox and production
keys are secured outside Git, OneDrive and the app with restricted local access.
Programme payout readiness is not established by API access.

viatorEnabled is true for PWA v64 testing. The next fresh iOS upload must use 1.0.8
(build 8), unless another upload has consumed that pair. Signing, iPhone external
browser open/return testing and submission are separate steps, not claimed here.
The prepared support/privacy disclosures ship with this PWA source. Review App
Privacy for any future native build that includes the feature.

Product status and itinerary checks do not guarantee future dates or operation.
The app does not quote provider prices or operate bookings/cancellations.

References:
- https://docs.viator.com/partner-api/technical/
- https://partnerresources.viator.com/travel-commerce/affiliate/basic-access/golden-path/
- https://www.viator.com/support/privacyPolicy
- https://developer.apple.com/app-store/review/guidelines/#goods-and-services-outside-of-the-app
