"""Isolate each slug's `solution` module during a session-wide `pytest problems/` run.

Every `problems/<slug>/tests.py` imports `from solution import <entry>`. The
module name `solution` is fixed because Pyodide writes the user's editor code
to `/home/pyodide/solution.py` at runtime. When we collect all slugs in a
single pytest session on the host, that same name must resolve to a different
file for each slug — otherwise whichever slug imports first wins the
`sys.modules` cache and the rest fail with `ImportError`.

`pytest_collectstart` fires before the Module collector imports `tests.py`,
so it's the right hook to prepend the slug dir to `sys.path` and evict any
cached `solution` module.
"""

from __future__ import annotations

import sys
from pathlib import Path

PROBLEMS_DIR = Path(__file__).parent.resolve()


def pytest_collectstart(collector) -> None:
    path = getattr(collector, "path", None)
    if path is None or path.is_dir() or path.name != "tests.py":
        return
    if path.parent.parent.resolve() != PROBLEMS_DIR:
        return

    slug_dir = str(path.parent)
    if slug_dir in sys.path:
        sys.path.remove(slug_dir)
    sys.path.insert(0, slug_dir)
    sys.modules.pop("solution", None)
