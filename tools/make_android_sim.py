# -*- coding: utf-8 -*-
"""Write android-sim.html - the app, behind a stubbed Android bridge.

Generated rather than committed so it can never drift from index.html, and
gitignored so it can never ship. See tools/android-bridge-sim.js for what the
stub actually pretends to be, and PUBLISHING.md for how to drive it.

Two pages come out of this:

  android-sim.html        a phone with a working store
  android-sim-nokey.html  a phone where the RevenueCat key was left blank,
                          which is the mistake worth having a test for -
                          without a guard it hands out every hidden gem free

Every local script gets a cache-busting query. Without it a browser happily
serves the app.js it read ten minutes ago, and you spend an afternoon
debugging a fault you already fixed.
"""
import io, os, re, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

s = io.open('index.html', encoding='utf-8').read()

anchor = '<script src="config.js"></script>'
assert s.count(anchor) == 1, 'config.js script tag moved'
s = s.replace(anchor,
              '<script src="tools/android-bridge-sim.js"></script>\n'
              '<script src="config.js"></script>\n'
              '<script>OAA_CONFIG.revenueCat.android = "goog_SIMULATED";\n'
              'OAA_CONFIG.partners.viatorPartnerId = "P00SIM";</script>')

v = str(int(time.time()))
s = re.sub(r'(<(?:script src|link[^>]*href)="(?!https?:)[^"?]+)(")', r'\1?v=' + v + r'\2', s)

io.open('android-sim.html', 'w', encoding='utf-8', newline='\n').write(s)
io.open('android-sim-nokey.html', 'w', encoding='utf-8', newline='\n').write(
    s.replace('OAA_CONFIG.revenueCat.android = "goog_SIMULATED";',
              'OAA_CONFIG.revenueCat.android = "";'))

print('android-sim.html and android-sim-nokey.html written (cache key %s)' % v)
print('serve the folder, then open either one instead of index.html')
