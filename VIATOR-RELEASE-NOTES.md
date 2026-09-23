# Viator links — prepared future update

This branch is separate from the owner's submitted iOS 1.0.7 (build 7). No
production publication or Apple review change is part of this preparation.

The first registry contains **176 adventure matches, 128 distinct products and
61 countries/territories**, checked on 23 September 2026. The separate owner
review list contains **46 proposed new ideas across 36 countries**. None were
added to the catalogue automatically. This is a first batch, not exhaustive
coverage of all 5,341 active adventures or Viator inventory.

## Behaviour

- Only individually reviewed product-page matches can receive a link. No generic
  search links, guessed product IDs or automatic catalogue additions.
- The option appears below Maps / Add to shortlist. Provider name, important tour
  details and a commission disclosure accompany it. A tour may include several
  adventures; customers must check the itinerary, options and departure city.
- Locked gems, paused adventures and country-level do-not-travel advisories
  suppress the link. A change to the adventure title or place invalidates the
  stored match until reviewed again.
- Only the public partner ID and a fixed campaign are added to the product URL.
  There is no Viator SDK, pixel, account identifier, user photo or API credential
  in the client. Viator's external website has its own privacy/cookie practices.
- All current matches are classic adventures. A rendering test checks that a
  synthetic locked gem suppresses its link and an owned pack reveals it. This
  is UI purchase gating, not encrypted catalogue secrecy: the existing offline
  catalogue and any future generated booking registry are public client assets.
- Tours are physical services booked with Viator/providers. Wayfinder's digital
  gem purchases continue through the existing Apple/RevenueCat implementation.

## Release steps still required

1. Confirm Viator partner readiness. The owner reported verification submitted;
   a working link builder does not establish programme approval or payout setup.
2. Review the linked-product registry and owner standby list. Keep proposed new
   adventures out of the catalogue until the owner accepts them. Recheck exact
   products before publication; prices/time-slot availability are not cached.
3. Set `viatorEnabled` to true only for the deliberate release. Regenerate and
   validate with `python tools/build_booking_links.py --write` then `--check`.
4. Advance the PWA cache version (currently v63); sync native assets; run the
   focused booking, access, availability, service-worker and website checks.
5. The next fresh iOS upload must be **1.0.8 (build 8)**, unless another upload
   already consumed that pair. Compile/sign and test external-browser opening
   and return on an iPhone. No native build/device test is claimed by this branch.
6. Publish the prepared support/privacy changes alongside activation. Reassess
   App Privacy against the exact implementation; do not silently change the
   current submitted version's declarations.
7. For the future store description, explain optional disclosed Viator links,
   provider handling of bookings/payments/cancellations, and separate gem IAPs.
   Do not edit the listing currently awaiting review for this dormant feature.

Apple's guideline 3.1.3(e) addresses physical goods/services consumed outside the
app; this does not guarantee approval of a future implementation:
https://developer.apple.com/app-store/review/guidelines/#goods-and-services-outside-of-the-app

Viator privacy statement: https://www.viator.com/support/privacyPolicy

## Scaling research

The first batch is not an exhaustive catalogue search. The coordination report
retains every remaining active adventure as a research queue. Viator's official
Affiliate API setup was located in the owner's existing account; its separate
licence agreement awaits the owner. No API key was generated or copied during
this preparation. If enabled later, use it only as licensed, keep credentials
outside Git/OneDrive/client code, and never activate fuzzy suggestions without
product-level review. Public website/API availability and dated itinerary checks
do not guarantee that a specific future departure can be booked.
