#!/usr/bin/env python3
"""Repair only the known course-share slug guards, preserving server hotfixes."""
from pathlib import Path
import sys

def patch(source):
    old = "if (!/^course-[a-z0-9]+$/.test(req.params.shareSlug))"
    new = "if (!/^(?:course-[a-z0-9]+|catalog-[a-z0-9]+(?:-[a-z0-9]+)*)$/.test(req.params.shareSlug))"
    routes = source.count("app.get('/:shareSlug', async (req, res, next) => {")
    if routes not in (1, 2) or source.count(old) + source.count(new) != routes:
        raise ValueError('Unrecognized share routes; no source was changed.')
    for guard in (old, new):
        expected = "app.get('/:shareSlug', async (req, res, next) => {\n  try {\n    " + guard + " return res.status(404).send('الصفحة غير موجودة.');\n    const result = await pool.query('SELECT * FROM courses WHERE share_slug=$1 AND active=true', [req.params.shareSlug]);"
        if source.count(expected) != source.count(guard):
            raise ValueError('Share route validation differs; no source was changed.')
    return source.replace(old, new)

if __name__ == '__main__':
    path = Path(sys.argv[1])
    source = path.read_text()
    changed = patch(source)
    if changed != source:
        path.write_text(changed)
    print('Course share routes prepared; published-only lookup retained.')
