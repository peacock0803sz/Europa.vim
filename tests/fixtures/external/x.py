"""Phase 3.8 fixture: target of `File ~/.cache/europa-test/x.py:10`.

The setup script `scripts/setup-error-fixture.ts` copies this file
into `~/.cache/europa-test/x.py` so the :EuropaJumpError smoke test
against `tests/fixtures/ipynb/error-external-file.ipynb` lands the
cursor on a real, in-repo body line.
"""

def foo():
    raise ValueError("oops from foo()")  # line 10 — :EuropaJumpError lands here
