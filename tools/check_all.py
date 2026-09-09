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
    ('sql',            'check_sql.py',       'unbalanced quotes, policies on missing tables'),
    ('release tools',  'test_play.py',       'the Play commands, against a fake API'),
    ('ios vs android', 'check_parity.py',    'do the two apps agree, prices included'),
]


def main():
    results = []
    for name, script, blurb in CHECKS:
        print('\n' + '-' * 68)
        print('  %s - %s' % (name, blurb))
        print('-' * 68)
        r = subprocess.run([sys.executable, os.path.join(ROOT, 'tools', script)], cwd=ROOT)
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
