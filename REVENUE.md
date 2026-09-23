# Making Wayfinder pay, without turning it into something else

> Historical brainstorming. The early catalogue counts, example prices and print-book
> concept below are not current release facts or approved plans. As of 23 September
> 2026, Wayfinder has 5,412 active adventures and 1,156 hidden gems. The eight
> one-time products are AUD $14.99 for All Continents and AUD $2.99 per existing
> continent pack; Antarctica is bundle-only. Memory photos remain on the user's
> phone, with user-controlled export/import, and are not uploaded by RL Applications.

Wayfinder is a curated list of 2,356 real places worth going to, which two or
three people tick off together. That sentence is the constraint on everything
below. A change that makes more money but makes that sentence less true is not
on this list, and four such ideas are named at the bottom under **Rejected**.

---

## Where the money comes from today

One place: six non-consumable in-app purchases unlocking hidden gems.

| | |
|---|---|
| Bundle, every gem | $9.99 |
| Per continent (×5 with content) | $1.99 |
| Store commission | 15% under the Small Business Program, 30% above $1M/yr |
| Gems | 255 of 2,356 entries (11%) |

That is a one-off payment from a small fraction of installs and then nothing
ever again, from a person who may use the app for years. It is not a bad
product — a single fair price for content, no subscription, no ads — but it is
the *only* product, and it stops earning the moment it is bought.

---

## The four levers, in the order they are worth doing

| | Lever | Build cost | Store cut | Fits the app? |
|---|---|---|---|---|
| 1 | **Price the packs correctly** | none — two numbers | 15–30% | yes, no change at all |
| 2 | **Booking links on bookable entries** | **done, switched off** | **none** | yes, if disclosed |
| 3 | **A printed adventure book** | 2–3 weeks | **none** | yes — it *is* the passport |
| 4 | **Gifting and family sharing** | small | 15–30% | yes |

Levers 2 and 3 pay no store commission at all, because Apple's guideline
3.1.3(e) says physical goods and real-world services consumed outside the app
**must not** use in-app purchase. A tour and a printed book are both exactly
that. So the awkward rule that forces them out of IAP is the same rule that
means Apple takes nothing from them.

---

## 1. The packs are underpriced

Researched against what the App Store actually charges for this category:

| App | What it does | Price |
|---|---|---|
| Skratch | scratch-off world map | $9.99 lifetime |
| Stampie | passport stamps | $19.99 lifetime |
| Been | countries visited | $19.99/year |
| Polarsteps | trip tracking | $34.99/year |
| Pin Traveler | map pins | $44.99 lifetime |
| Bucket List App | list you write yourself | $49.99/year |
| Visited | map + stats | $59.99 lifetime |

Every one of those is a **tracker**. You install it and it is empty; the value
is whatever you type into it. Wayfinder arrives with 2,356 researched entries
across 123 countries, and the paid half is 255 of them chosen and written.
Pricing that below Skratch — an app whose entire function is scratching a map —
is not a bargain, it is a signal that there is not much in the box.

**Recommendation: bundle $19.99, continents $4.99.**
Still under Stampie, under Been's *first year*, and a third of Visited.

Modelling per 1,000 installs, using a 2% paid conversion (typical for a
one-off content unlock in a niche utility) and assuming conversion falls by
about a third when the price doubles:

| | $9.99 | $19.99 |
|---|---|---|
| Buyers per 1,000 installs | 20 | 14 |
| Gross | $199.80 | $279.86 |
| After 15% | $169.83 | **$237.88** |

**+40% on the same app, same content, same day.** The conversion drop is a
guess and the honest risk is that it is worse than a third; if it is, the price
is two lines in `store.js` and can go back down. Nothing else depends on it.

**This is your call, not mine, and the code still says $9.99.** Changing what
you decided without asking would be the wrong move. When you want it:

```
store.js → PACKS → price: '$19.99' (bundle), '$4.99' (each continent)
```

and set the matching price tier in App Store Connect and Play Console. The app
already prefers the store's own localised price over the string in the file, so
the only thing the string affects is what a browser shows.

---

## 2. Reviewed Viator experience links

The owner verified the Viator partner account and authorised Basic Affiliate API
access. The production API's product URLs include public partner ID `P00321485`
and attribution parameters. Wayfinder preserves those returned URLs exactly;
it does not invent or append tracking fields. Partner payout readiness has not
been independently confirmed.

The PWA v64 source enables this feature; it is not in the 1.0.7 build submitted
to Apple. No generic search links are allowed: this is the
owner's explicit choice. `data/viator-links.json` holds reviewed mappings and
`tools/build_booking_links.py` validates `booking-links.js`; pass `--write` to
regenerate it explicitly. The standard check suite detects stale output.

The button appears beneath Maps and Add to shortlist. Exact experiences use
“View experience on Viator”; optional paid guided visits are labelled as such.
The registry pins adventure ID, place and country, canonical product URL and
product code. Locked gems, unavailable listings and avoid-level destinations
cannot display a booking link. No network request or provider tracking code runs
before the user deliberately opens a link. Affiliate attribution contains no
Wayfinder account, email, photo, progress or location data.

Commission disclosure is shown beside each link. Tour payments, booking changes
and refunds are handled by Viator/the operator and are separate from the app's
digital gem purchases. Revenue is not guaranteed and depends on current partner
terms and eligible completed bookings. Seventy-one distinct researched adventures
were added after quality review; commission availability must not determine
inclusion, ranking or hidden-gem status.

No API credentials are required for these ordinary outbound links. Exact product
matching and availability are separate: customers still need to check the current
itinerary, options, departure point and dates on Viator. Dates/prices/reviews and
provider images are not copied into the app.

---

## 3. The printed adventure book — the biggest single lever

**Status: specified here, not built. Two to three weeks of work.**

### Why this is the one to build

Polarsteps has 20 million users and takes **100% of its revenue from printed
travel books**. Not subscriptions, not ads — printed books, at €30–80, made
from photos the user already put in the app, printed on demand by Peecho (now
part of Prodigi) so no stock is ever held.

Wayfinder already holds every input that book is made of, and has since before
this was a revenue idea:

- photos, per adventure, stored privately on the person's phone (a printed-book
  service would require a new, explicit, user-initiated transfer design)
- the memory written against each one
- the star rating
- the date and time it was ticked
- the passport stamp per country, with its date
- trips, which are already a grouping of adventures with a name and dates

That is a book. It is currently a book nobody can hold.

### What it would be

*The Wayfinder Passport* — a hardcover, one spread per adventure completed:
the photo, the memory, where it is, the date it was ticked, who ticked it. The
country stamps as a page each. A map at the front with the route.

It is priced as an object, not a feature: **$39–49 for 24–40 pages hardcover**,
against a print-and-ship cost around $18–24 through Prodigi's API, so roughly
**$18–22 margin per book with no store commission at all**.

Modelled at 1.5% of installs ordering one book over the app's life: **about
$270 per 1,000 installs** — more than the gem packs earn at the current price,
from people who have already been somewhere and want proof of it.

### What it needs

1. **A print partner account.** Prodigi (which absorbed Peecho in 2024) has a
   print API, wholesale pricing and worldwide fulfilment. Free to open.
2. **A composer.** The one real piece of work: laying out photos and text into
   a print-ready PDF at 300dpi with bleed. Server-side, not in the app —
   client-side PDF generation cannot hit print quality and would fall over on
   a phone with sixty photos.
3. **A checkout outside IAP.** Stripe or Apple Pay. This is required, not
   optional, under 3.1.3(e) — a printed book must not go through in-app
   purchase.
4. **A decision about photo resolution, and it has a deadline.**

   Uploads are downscaled on the device to a 1,600px long edge at JPEG 0.82
   (`app.js`, `MAX_EDGE`). That was the right call for its purpose — Supabase's
   free tier gives 1 GB, and full-size phone photos at 3–5 MB each would fill it
   in about 250 pictures.

   For print it means: 1,600px is 5.3 inches at 300dpi, or 8 inches at 200dpi.
   Good enough for a spread with one photo and text beside it, and for anything
   up to about A5. Not enough for a full-bleed page in a larger book.

   Three ways out, and one of them expires:

   - **Design the book around 1,600px.** Costs nothing, no deadline, rules out
     the full-page format. Probably the right answer.
   - **Raise `MAX_EDGE` to 2,400 now** and accept roughly 2× the storage. Only
     helps photos taken *after* the change.
   - **Keep the original alongside the display copy.** Best quality, most
     storage, and the only option that has to be decided before people start
     using the app — because a photo taken today at 1,600px is 1,600px forever.

### Why it does not change what the app is

It does not touch the list, the map, the ticks or the sharing. It is a way of
keeping what you already did in the app. Somebody who never buys one loses
nothing at all.

---

## 4. Gifting and family sharing — small, cheap, do it at launch

- **Family Sharing on all six products.** One checkbox in App Store Connect. A
  household app that charges a couple twice for the same list will be told so
  in a review. It costs nothing and it is already recommended in `PUBLISHING.md`.
- **Gift the bundle.** Apple supports gifting non-consumables with no extra
  code. Turn it on. A shared checklist is a natural present between the two
  people who use it together.

---

## What it adds up to

Per 1,000 installs, over the life of those installs. Every number is an
assumption, stated so you can disagree with it:

| | Today | With all four |
|---|---|---|
| Gem packs | $170 | $238 |
| Booking commission | — | $22–60 |
| Printed books | — | $270 |
| **Total** | **$170** | **$530–570** |

Roughly **3×**, and the shape changes as much as the size: today all revenue
arrives once, from the same moment. Afterwards, two of the three lines earn
again every time somebody actually travels — which is the behaviour the app
exists to encourage anyway.

---

## Rejected, and why

**Advertising.** A banner over a curated recommendation destroys the only thing
the app sells, which is that the list is honest. It also drags in tracking
SDKs, a privacy label that stops saying "None", and an age-rating conversation.

**Selling or sharing location data.** No. The privacy label currently says no
tracking and no data sold, and that is worth more than the money.

**A subscription for the existing content.** Charging monthly for a list that
does not change is the thing users complain about most loudly and the reason
several competitors have poor reviews. A subscription is defensible only if
something arrives every month, and nothing does.

**Themed packs (the Star Wars idea).** Parked at your instruction, and it is
the right call for now. Worth revisiting after launch: the mechanism already
exists — a pack is a string on an entry — so it is content work, not code work.
The catch is licensing. A "filming locations" pack naming real places is fine;
calling it *Star Wars* is not, without permission from Lucasfilm.

---

## In what order

1. **Now, free:** apply to Viator and GetYourGuide. Both take days to weeks and
   need a live site, which you have. Nothing else is blocked on them.
2. **Before submission:** decide on the price. Family Sharing on. Gifting on.
3. **After launch, with real numbers:** open a Prodigi account and build the
   book composer. Do it once there are enough completed adventures with photos
   for a book to be worth printing — building it for an empty app is building
   it blind.
