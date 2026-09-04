"""Sanity-check the SQL files before somebody pastes them into Supabase.

Not a parser - Postgres is the only thing that can really validate these. It
catches the mistakes that are easy to make in a hand-written migration and
expensive to find out about halfway through running it: an unclosed dollar
quote, unbalanced parentheses, a policy on a table that is never created, a
trigger on a missing function.

    python tools/check_sql.py
"""
import glob
import io
import os
import re
import sys

problems = []


def strip_comments(sql):
    """Remove -- line comments and /* */ blocks, leaving string literals be."""
    out, i, n = [], 0, len(sql)
    while i < n:
        two = sql[i:i + 2]
        if two == '--':
            j = sql.find('\n', i)
            i = n if j < 0 else j
        elif two == '/*':
            j = sql.find('*/', i)
            i = n if j < 0 else j + 2
        elif sql[i] == "'":
            j = i + 1
            while j < n:
                if sql[j] == "'" and sql[j:j + 2] != "''":
                    break
                j += 2 if sql[j:j + 2] == "''" else 1
            out.append(sql[i:j + 1])
            i = j + 1
        else:
            out.append(sql[i])
            i += 1
    return ''.join(out)


def check(path):
    raw = io.open(path, encoding='utf-8').read()
    name = os.path.basename(path)
    sql = strip_comments(raw)

    # Dollar quoting. $$ ... $$ and $tag$ ... $tag$ must pair up.
    tags = re.findall(r'\$([a-zA-Z_]*)\$', sql)
    unpaired = [t for t in set(tags) if tags.count(t) % 2]
    if unpaired:
        problems.append(f'{name}: unclosed dollar quote '
                        + ', '.join(f'${t}$' for t in unpaired))

    # Parentheses, ignoring anything inside a dollar-quoted body since those
    # are function bodies with their own rules.
    outside = re.sub(r'\$([a-zA-Z_]*)\$.*?\$\1\$', '', sql, flags=re.S)
    depth = outside.count('(') - outside.count(')')
    if depth:
        problems.append(f'{name}: {abs(depth)} unbalanced '
                        + ('opening' if depth > 0 else 'closing') + ' parenthesis')

    # Every policy and trigger should name something the file, or an earlier
    # one, actually creates.
    created = set(re.findall(r'create table (?:if not exists )?([\w.]+)', sql, re.I))
    return name, sql, created


def main():
    files = sorted(glob.glob(os.path.join('supabase', '*.sql')))
    if not files:
        print('no SQL files found')
        return 1

    all_tables = set()
    parsed = []
    for path in files:
        name, sql, created = check(path)
        all_tables |= created
        parsed.append((name, sql))

    # Tables that policies are attached to, checked across the whole set
    # because the files are meant to be run in order.
    for name, sql in parsed:
        for target in re.findall(r'on\s+(public\.\w+)\s+for\s+(?:select|insert|update|delete|all)',
                                 sql, re.I):
            if target not in all_tables:
                problems.append(f'{name}: policy on {target}, which nothing creates')
        for fn in re.findall(r'execute function\s+([\w.]+)\(', sql, re.I):
            base = fn.split('.')[-1]
            if not any(re.search(r'create or replace function\s+[\w.]*' + re.escape(base),
                                 s2, re.I) for _n, s2 in parsed):
                problems.append(f'{name}: trigger calls {fn}(), which nothing defines')

    print(f'{len(files)} SQL file(s): ' + ', '.join(os.path.basename(f) for f in files))
    print(f'{len(all_tables)} tables created: ' + ', '.join(sorted(all_tables)) + '\n')

    for p in problems:
        print('PROBLEM — ' + p)
    if not problems:
        print('Nothing obviously wrong. Postgres is still the real test.')
    return 1 if problems else 0


if __name__ == '__main__':
    raise SystemExit(main())
