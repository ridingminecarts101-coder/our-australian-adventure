# Viator links — prepared future update

Prepared on 23 September 2026, separately from submitted iOS 1.0.7 (build 7).
No production publication or Apple submission change occurred.

The catalogue includes 45 suitable owner-approved additions and 18 new gems.
One original proposal was excluded because the product did not establish the
specific Certovka canal experience. The owner removed the forced 20% quota:
use genuine discoveries and worthwhile, reasonably balanced paid packs, without
filler or relabelling famous attractions as gems.

All 5,386 active adventures have dated targeted production API search records.
The registry contains 272 individually verified adventure matches, 208 ACTIVE
products and 87 countries/territories. Product-page or full-product API itinerary
review establishes the activity match; a separate API status check rejects
inactive products. All 208 matched products also have a current or future booking
schedule; this does not guarantee capacity on a chosen date. Search snippets
alone are insufficient. Eighty researched
adventure links were excluded after their 61 products were inactive or unavailable
through the API. Fourteen additional ideas remain in the owner review report.

This is not a complete yes/no determination: 4,597 adventures still have unreviewed
search candidates, 437 had no result in the recorded searches, and 80 need
replacement products. Search results cannot establish permanent absence.
Searches use the named place, retry activity wording on zero results, and filter
by destination country where mapped. The first 50 results are recorded; 2,631
entries have more results beyond that limit. No whole Viator inventory was ingested.

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

viatorEnabled remains false in this prepared branch until deliberate release.
Before activation, recheck product status, bump the PWA cache from v63, sync
native assets and run release checks. The next fresh iOS upload must use 1.0.8
(build 8), unless another upload has consumed that pair. Signing, iPhone external
browser open/return testing and submission are separate steps, not claimed here.
Publish the prepared support/privacy disclosures alongside activation and review
App Privacy for that exact build.

Product status and itinerary checks do not guarantee future dates or operation.
The app does not quote provider prices or operate bookings/cancellations.

References:
- https://docs.viator.com/partner-api/technical/
- https://partnerresources.viator.com/travel-commerce/affiliate/basic-access/golden-path/
- https://www.viator.com/support/privacyPolicy
- https://developer.apple.com/app-store/review/guidelines/#goods-and-services-outside-of-the-app
