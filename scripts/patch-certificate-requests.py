#!/usr/bin/env python3
"""Patch only the known certificate hooks; refuse unexpected live source."""
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
spec = json.loads(Path(sys.argv[2]).read_text())
prepared = {}
for filename, changes in spec.items():
    target = root / filename
    source = target.read_text()
    for change in changes:
        old, new = change['old'], change['new']
        if source.count(old) == 1:
            source = source.replace(old, new, 1)
        elif source.count(new) == 1:
            continue
        else:
            raise SystemExit(f'Unrecognized {filename} near {change["label"]}; no live files changed.')
    prepared[target] = source
for target, source in prepared.items():
    target.write_text(source)
print('Prepared certificate request hooks. Unrelated server code is preserved.')
