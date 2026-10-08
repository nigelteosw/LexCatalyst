"""Keeps OpenRouter keys out of logs, whatever code path logs them.

Installed as a log record factory, so it covers every logger and handler, including records
that propagate from child loggers (a filter attached to the root logger would not see them).
"""

import logging
import re

_OPENROUTER_KEY = re.compile(r"sk-or-[A-Za-z0-9_\-]+")
_REDACTED = "sk-or-[redacted]"


def _redact(value):
    return _OPENROUTER_KEY.sub(_REDACTED, value) if isinstance(value, str) else value


def install_secret_redaction() -> None:
    previous = logging.getLogRecordFactory()

    def factory(*args, **kwargs) -> logging.LogRecord:
        record = previous(*args, **kwargs)
        record.msg = _redact(record.msg)
        if isinstance(record.args, tuple):
            record.args = tuple(_redact(a) for a in record.args)
        elif isinstance(record.args, dict):
            record.args = {k: _redact(v) for k, v in record.args.items()}
        return record

    logging.setLogRecordFactory(factory)
