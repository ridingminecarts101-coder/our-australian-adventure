# -*- coding: utf-8 -*-
"""Run every check, then report.

ASCII only in the output on purpose: the Windows console is cp1252 and
raises UnicodeEncodeError on a box-drawing character rather than degrading
to a question mark, which turns a passing check run into a crash.

The old `npm run check` chained them with &&, which meant check_quality's
standing complaint about thin regions - a content note, deliberately not fixed -
stopped check_sql and the release-tooling tests from ever running. A check that
silently skips other checks is worse than no check.

So: everything runs, every time. The exit code is non-zero if anything failed,
so CI and a shell prompt still get a truthful answer.
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CHECKS = [
    ('source data',    'lint_source.py',     'every data/src file, before it is built'),
    ('geography',      'check_geography.py', 'countries, continents and the map'),
    ('code',           'check_code.py',      'dead functions, orphan files, unheard handlers'),
    ('content',        'check_quality.py',   'thin regions, narrow categories, tall claims'),
    ('research refs',  'check_research_sources.py', 'row sources and hidden-gem rationale'),
    ('coverage math',  'test_content_inventory.py', 'exact one-in-five planning boundaries'),
    ('country moves',  'test_content_migrations.py', 'country corrections preserve saved IDs'),
    ('sql',            'check_sql.py',       'unbalanced quotes, policies on missing tables'),
    ('account client', 'check_account_groups.py', 'recoverable identity and consent-safe client contract'),
    ('auth upgrade',    'test_auth_upgrade.js', 'verified-email sequencing and safe schema fallback'),
    ('startup',        'test_startup.js', 'visible failures, retry controls and preserved offline data'),
    ('offline cache',  'test_service_worker.js', 'service worker network and update regressions'),
    ('photo failures', 'test_photo_failures.js', 'failed deletion preserves metadata and legacy files stay aligned'),
    ('local photos',   'test_local_photos.js', 'device-local photo ownership, transactions and account boundaries'),
    ('photo pickers',  'test_photo_picker_handlers.js', 'library and camera FileList capture and same-file re-picks'),
    ('native photos',  'test_photo_files.js', 'private native filesystem paths and image integrity'),
    ('sync races',     'test_sync_races.js', 'deferred responses cannot cross edits or accounts'),
    ('advisories',     'test_advisory_behavior.js', 'avoid exclusions and explicit detail warnings'),
    ('security rules', 'check_security_migration.py', 'static preservation and RLS migration contract'),
    ('postgres RLS',   'test_personal_ownership.mjs', 'ownership, outsiders, consent, leave and deletion in PGlite'),
    ('photo boundary', 'test_device_local_photo_policy.mjs', 'old clients cannot upload while legacy read and deletion remain'),
    ('community RLS',  'test_community_security.mjs', 'post authorship, votes, reports and moderation in PGlite'),
    ('release tools',  'test_play.py',       'the Play commands, against a fake API'),
    ('billing',        'check_billing.py',   'prices, account identity and native release guards'),
    ('bundle access',  'test_bundle_access.js', 'Antarctica exclusivity and locked-content privacy'),
    ('ios vs android', 'check_parity.py',    'do the two apps agree, prices included'),
]


def main():
    results = []
    for name, script, blurb in CHECKS:
        print('\n' + '-' * 68)
        print('  %s - %s' % (name, blurb))
        print('-' * 68)
        runtime = 'node' if script.endswith(('.mjs', '.js')) else sys.executable
        r = subprocess.run([runtime, os.path.join(ROOT, 'tools', script)], cwd=ROOT)
        results.append((name, r.returncode))

    print('\n' + '=' * 68)
    bad = [n for n, rc in results if rc]
    for name, rc in results:
        print('  %-15s %s' % (name, 'ok' if rc == 0 else 'found something'))
    print('=' * 68)

    if bad:
        print('\n  %s had something to say. Read it above and decide - some of '
              'these\n  are notes rather than faults.\n' % ', '.join(bad))
    else:
        print('\n  All clear.\n')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
