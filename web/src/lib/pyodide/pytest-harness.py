"""Pytest plugin that collects per-test outcomes into a JSON-ready summary.

Loaded by the Pyodide worker before `pytest.main(...)` is invoked. The worker
pulls `_HARNESS_RESULT` out of the plugin module after the run completes and
ships it back to the main thread.

One plugin instance accumulates results for exactly one pytest invocation;
the worker clears `_HARNESS_RESULT` between runs.
"""

from __future__ import annotations

import io
from typing import Any

_HARNESS_RESULT: dict[str, Any] = {}


class _Collector:
    def __init__(self) -> None:
        self.tests: list[dict[str, Any]] = []
        self.passed = 0
        self.failed = 0
        self.errored = 0
        self.skipped = 0

    # ---- pytest hooks -----------------------------------------------------

    def pytest_runtest_logreport(self, report: Any) -> None:  # noqa: D401
        # `call` is the phase we care about for pass/fail; `setup` / `teardown`
        # only surface here when they themselves fail (treated as errors).
        if report.when == "call":
            outcome: str
            failure_message: str | None = None

            if report.passed:
                outcome = "passed"
                self.passed += 1
            elif report.failed:
                outcome = "failed"
                failure_message = _truncate(str(report.longrepr))
                self.failed += 1
            elif report.skipped:
                outcome = "skipped"
                self.skipped += 1
            else:
                outcome = "error"
                failure_message = _truncate(str(report.longrepr))
                self.errored += 1

            entry: dict[str, Any] = {
                "name": report.nodeid,
                "outcome": outcome,
                "durationMs": int(report.duration * 1000),
            }
            if failure_message is not None:
                entry["failureMessage"] = failure_message
            stdout = _captured_stdout(report)
            if stdout:
                entry["stdout"] = _truncate(stdout)
            self.tests.append(entry)

        elif report.failed and report.when in ("setup", "teardown"):
            # Setup/teardown errors — surface as a synthetic "error" entry if
            # there's no matching call record (pytest skips `call` in that case).
            if not any(t["name"] == report.nodeid for t in self.tests):
                self.errored += 1
                self.tests.append(
                    {
                        "name": report.nodeid,
                        "outcome": "error",
                        "durationMs": int(report.duration * 1000),
                        "failureMessage": _truncate(
                            f"{report.when} error:\n{report.longrepr}"
                        ),
                    }
                )

    def pytest_sessionfinish(self, session: Any, exitstatus: int) -> None:
        _ = session, exitstatus
        _HARNESS_RESULT.clear()
        _HARNESS_RESULT.update(
            {
                "passed": self.passed,
                "failed": self.failed,
                "errored": self.errored,
                "skipped": self.skipped,
                "total": self.passed + self.failed + self.errored + self.skipped,
                "tests": self.tests,
            }
        )


def _captured_stdout(report: Any) -> str:
    sections = getattr(report, "sections", None) or []
    out: list[str] = []
    for title, content in sections:
        if "stdout" in title:
            out.append(content)
    return "\n".join(out)


def _truncate(s: str, limit: int = 2048) -> str:
    if len(s) <= limit:
        return s
    return s[:limit] + "\n… [truncated]"


def register(plugin_manager: Any) -> _Collector:
    """Invoked by the worker to attach the collector to a pytest session."""
    collector = _Collector()
    plugin_manager.register(collector, name="grind75-harness")
    return collector


def reset() -> None:
    """Clear the accumulated result — called before each run."""
    _HARNESS_RESULT.clear()


def result() -> dict[str, Any]:
    """Return the most recent run's summary (populated by `pytest_sessionfinish`)."""
    # Copy so the caller can't mutate our internal state.
    return dict(_HARNESS_RESULT)


# Capture stdout for each test without forcing `-s`: pytest's default capfd
# is enough, we read it off `report.sections`. But pytest only populates
# `sections` when capture actually fired, which it does by default.
_ = io  # keep the import for callers that may want to monkey-patch stdout.
