/* Booking links — the one revenue stream that costs the reader nothing.
 *
 * WHY THIS EXISTS AT ALL
 *
 * Wayfinder tells you a place is worth going to. A good number of those places
 * are things you have to book: a boat, a guide, a ticket with a time on it. The
 * app already loses that person to a search engine at exactly that moment, so
 * the choice is not "affiliate links or a pure app" — it is whether the search
 * they were always going to run happens here or somewhere else.
 *
 * WHY IT DOES NOT COMPROMISE THE LIST
 *
 * Read this before adding anything to it, because it is the whole design:
 *
 *   - Nothing is here because it pays. The link is generated FROM the entry,
 *     never the other way round. No partner can put a place on the list, move
 *     it up, or flag it as a gem; there is no field in the data a partner
 *     could write to.
 *   - No adventure changes because a booking exists for it. Same words, same
 *     order, same everything. The link is one extra button below the fold.
 *   - Nothing is hidden. The disclosure line is not optional and not a
 *     tooltip.
 *   - Categories where booking is nonsense do not get a button. Standing on a
 *     headland is free; offering to sell it is how an app stops being trusted.
 *
 * WHY THIS IS NOT AN IN-APP PURCHASE
 *
 * Apple's guideline 3.1.3(e) is explicit that physical goods and services
 * consumed outside the app must NOT use in-app purchase. A boat trip in
 * Croatia is exactly that. So this route is not merely permitted, it is the
 * required one — and it carries no store commission at all, unlike the gem
 * packs, which lose 15-30% before we see them.
 *
 * TURNING IT ON
 *
 * Dead until OAA_CONFIG.partners holds an id. No id, no button, no disclosure,
 * no behaviour change of any kind — which is the state it ships in until the
 * affiliate applications are approved.
 */

/* Categories where somebody plausibly books something.
 *
 * Deliberately conservative. History and Culture are in because they are
 * museums, tickets and guided walks; Scenic, Road Trip, City, Beach, Outback,
 * Stargazing and Nature are out because they are places you simply go, and a
 * Book button under "walk out to the headland at sunset" reads as a shop
 * pretending to be a guide.
 */
const BOOKABLE = new Set([
  'Water',        // boats, dives, kayaks - almost always booked
  'Wildlife',     // guided by definition
  'Adrenaline',   // operators, waivers, timed slots
  'Food & Drink', // tastings, cellar doors, food walks
  'Culture',      // tickets and guided walks
  'History',      // sites with entry, skip-the-queue, guides
  'Island',       // ferries and day trips
  'Snow',         // lessons, lift passes, guided descents
]);

function partnerConfig() {
  return (window.OAA_CONFIG && OAA_CONFIG.partners) || {};
}

/* Is any of this switched on? */
function bookingEnabled() {
  const p = partnerConfig();
  return !!(p.viatorPartnerId || p.getYourGuidePartnerId);
}

/* What to search the partner for.
 *
 * The place and the country, not the adventure title. Titles here are written
 * as instructions - "Cage-dive with great white sharks out of Port Lincoln" -
 * and pasted into a tour search they match nothing at all. The place name plus
 * the country is what an operator's own listing is titled, and it is what
 * actually returns results.
 */
function bookingQuery(a) {
  const country = typeof countryName === 'function' ? countryName(a.country) : a.country;
  return [a.place, country].filter(Boolean).join(', ');
}

/* The outbound link, or null when there is nothing to offer.
 *
 * Viator first where both are configured: the wider catalogue outside Europe,
 * and the better rate. Nothing about the choice is visible to the reader
 * beyond the name of the site they land on, which is named on the button.
 */
function bookingLink(a) {
  if (!a || !bookingEnabled()) return null;
  if (typeof isLocked === 'function' && isLocked(a)) return null;   // never sell past a paywall
  if (!BOOKABLE.has(a.category)) return null;

  const p = partnerConfig();
  const q = bookingQuery(a);

  if (p.viatorPartnerId) {
    const url = new URL('https://www.viator.com/searchResults/all');
    url.searchParams.set('text', q);
    url.searchParams.set('pid', p.viatorPartnerId);
    url.searchParams.set('mcid', p.viatorCampaignId || '42383');
    url.searchParams.set('medium', 'link');
    return { url: url.toString(), site: 'Viator' };
  }

  const url = new URL('https://www.getyourguide.com/s/');
  url.searchParams.set('q', q);
  url.searchParams.set('partner_id', p.getYourGuidePartnerId);
  if (p.getYourGuideCampaign) url.searchParams.set('cmp', p.getYourGuideCampaign);
  return { url: url.toString(), site: 'GetYourGuide' };
}

/* Said plainly, every time, on the same screen as the link.
 *
 * Required by the FTC and by the equivalent rules in the UK, EU and Australia,
 * and it is the right thing regardless: a reader deciding whether to trust the
 * recommendation is entitled to know we are paid if they act on it.
 */
const BOOKING_DISCLOSURE =
  'We get a small commission if you book through this. It costs you nothing '
  + 'extra, and nothing on this list is here because it pays.';
