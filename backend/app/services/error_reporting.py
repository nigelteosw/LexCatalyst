"""User-facing messages for failures we did not anticipate.

The client only sees a short message with a reference; the exception and traceback
go to the server log under the same reference so a report can be traced.
"""

import logging
import uuid

logger = logging.getLogger("lexcatalyst.errors")


def unexpected_error_detail(feature: str, exc: BaseException) -> str:
    reference = uuid.uuid4().hex[:8]
    logger.error(
        "Unexpected %s error (reference %s): %r", feature, reference, exc, exc_info=exc,
    )
    return (
        f"{feature} hit an unexpected problem on our side. Please try again, and if it "
        f"keeps happening, share this reference with support: reference {reference}."
    )
