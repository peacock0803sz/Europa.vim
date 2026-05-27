"""Phase 3.8 fixture: target of `File ./tests/fixtures/external/x.py:10`.

`tests/fixtures/ipynb/error-external-file.ipynb` references this file
in place at `./tests/fixtures/external/x.py:10` (relative to the repo
root), so the :EuropaJumpError smoke test lands the cursor on a real,
in-repo body line — no copy/setup step required.
"""

def foo():
    raise ValueError("oops from foo()")  # line 10 — :EuropaJumpError lands here
