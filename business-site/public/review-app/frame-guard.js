/* Defense in depth for hosts that cannot emit CSP frame-ancestors headers.
 * The app's real anti-framing control must still be an HTTP response header.
 */
'use strict';

(() => {
  let framed = true;
  try { framed = window.self !== window.top; }
  catch { framed = true; }
  if (!framed) return;

  window.__WAYFINDER_FRAMED__ = true;

  // Hide the parser-built page before it can be painted or interacted with.
  const veil = document.createElement('style');
  veil.textContent = 'html{visibility:hidden!important}';
  document.head.appendChild(veil);

  const refuse = () => {
    const main = document.createElement('main');
    main.setAttribute('role', 'alert');
    main.style.cssText = 'max-width:36rem;margin:12vh auto;padding:1.5rem;border-radius:12px;font:16px/1.55 system-ui,sans-serif;color:#241c17;background:#f6efe6';

    const heading = document.createElement('h1');
    heading.textContent = 'Open Wayfinder directly';
    const explanation = document.createElement('p');
    explanation.textContent = 'Wayfinder does not run inside another website. Open it in its own tab to protect your account and device-local data.';
    const link = document.createElement('a');
    link.href = window.location.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.style.color = '#8c3d1f';
    link.textContent = 'Open Wayfinder';

    main.append(heading, explanation, link);
    document.body.replaceChildren(main);
    veil.remove();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refuse, { once: true });
  } else {
    refuse();
  }
})();
