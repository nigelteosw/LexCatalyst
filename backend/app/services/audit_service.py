"""Retrieval audit log: firms ask who queried what and which documents came back."""

from sqlalchemy.orm import Session

from app.models import RetrievalAuditEvent

MAX_QUERY_CHARS = 2000


def record_retrieval(
    db: Session,
    *,
    user_id: str,
    kind: str,
    query: str,
    returned_ids: list[str],
) -> RetrievalAuditEvent:
    event = RetrievalAuditEvent(
        user_id=user_id,
        kind=kind,
        query=query[:MAX_QUERY_CHARS],
        returned_ids=list(returned_ids),
    )
    db.add(event)
    db.commit()
    return event
