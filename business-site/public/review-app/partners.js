/* Only individually reviewed Viator products are eligible for a booking link.
 * The public partner ID identifies RL Applications, never the signed-in user.
 * No provider request, pixel or SDK runs until the user opens the external link.
 * New catalogue suggestions live in the owner review list, not this registry.
 */
function partnerConfig() {
  return (window.OAA_CONFIG && OAA_CONFIG.partners) || {};
}

function bookingEnabled() {
  const p = partnerConfig();
  return p.viatorEnabled === true && /^P\d+$/.test(p.viatorPartnerId || '');
}

function bookingLink(a) {
  if (!a || !bookingEnabled()) return null;
  if (a.availability && a.availability.status === 'unavailable') return null;
  if (typeof isLocked === 'function' && isLocked(a)) return null;
  if (typeof advisoryFor === 'function' && advisoryFor(a.country)?.level === 'avoid') return null;
  const links = typeof VIATOR_BOOKING_LINKS === 'undefined' ? {} : VIATOR_BOOKING_LINKS;
  const entry = links[String(a.id)];
  if (!entry || entry.status !== 'verified' || entry.country !== a.country) return null;
  // Pin identity and activity so catalogue edits cannot silently change the match.
  if (entry.place !== a.place || entry.adventure_title !== a.title
      || !['exact', 'guided_option'].includes(entry.match_type)) return null;
  let url;
  try { url = new URL(entry.viator_url); } catch { return null; }
  if (url.protocol !== 'https:' || url.hostname !== 'www.viator.com'
      || url.username || url.password || url.port || url.search || url.hash
      || !/^\/tours\/[^/]+\/[^/]+\/d\d+-[A-Za-z0-9_]+$/.test(url.pathname)
      || !url.pathname.endsWith('-' + entry.product_code)) return null;
  const p = partnerConfig();
  let affiliate;
  try { affiliate = new URL(entry.affiliate_url); } catch { return null; }
  if (affiliate.protocol !== 'https:' || affiliate.hostname !== 'www.viator.com'
      || affiliate.username || affiliate.password || affiliate.port || affiliate.hash
      || !/^\/(?:[a-z]{2}-[A-Z]{2}\/)?tours\/[^/]+\/[^/]+\/d\d+-[A-Za-z0-9_]+$/.test(affiliate.pathname)
      || !affiliate.pathname.endsWith('-' + entry.product_code)
      || [...affiliate.searchParams].length !== 4
      || affiliate.searchParams.get('pid') !== p.viatorPartnerId
      || affiliate.searchParams.get('mcid') !== '42383'
      || affiliate.searchParams.get('medium') !== 'api'
      || affiliate.searchParams.get('api_version') !== '2.0') return null;
  // Viator says its API productUrl contains affiliate attribution. Keep that
  // URL byte-for-byte; rebuilding or extending it can lose commission credit.
  return {
    url: entry.affiliate_url, site: 'Viator',
    details: entry.match_note,
    title: entry.product_title,
    label: entry.match_type === 'guided_option' ? 'View matching option on Viator' : 'View experience on Viator',
    note: entry.match_type === 'guided_option'
      ? 'Check the itinerary and options described above. This may be part of a longer tour or require an admission upgrade.'
      : 'Check the itinerary, departure point, options and availability before booking.',
  };
}
