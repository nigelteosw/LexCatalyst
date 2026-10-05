"""Precedent: how has the firm drafted this clause before?

Classification and term extraction are rules-only, so no clause text is sent to an LLM.
Retrieval reuses the permission-scoped document and Knowledge Bank searches.
"""

import re
from collections import Counter
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Document, Matter, User
from app.services.knowledge_bank_service import search_kb_for_chat
from app.services.rag_service import search_documents

CLAUSE_KEYWORDS: dict[str, tuple[str, ...]] = {
    "option_period": ("option period", "exercise the option", "option to purchase", "option fee", "grant of option"),
    "governing_law": ("governed by", "governing law", "laws of"),
    "limitation_of_liability": (
        "shall not be liable", "aggregate liability", "limitation of liability", "consequential loss", "liability",
    ),
    "termination": ("terminate", "termination"),
    "confidentiality": ("confidential",),
    "payment_terms": ("shall pay", "invoice", "payment", "due date"),
    "notice": ("notice shall", "notices", "in writing to"),
}
CLAUSE_TYPES: tuple[str, ...] = (*CLAUSE_KEYWORDS, "other")

_DAYS = re.compile(r"\(?\b(\d{1,3})\)?\s+(?:(business|working|calendar)\s+)?days?\b", re.I)
_PERCENT = re.compile(r"\b(\d{1,3}(?:\.\d+)?)\s*(?:%|per\s*cent\b|percent\b)", re.I)
_AMOUNT = re.compile(r"(S\$|US\$|SGD|USD|£|€|\$)\s?(\d[\d,]*(?:\.\d+)?)")
_JURISDICTION = re.compile(
    r"laws of (?:the )?(Republic of Singapore|Singapore|England and Wales|England|Hong Kong|New York|Malaysia)",
    re.I,
)
_JURISDICTION_NAMES = {"republic of singapore": "Singapore"}

EXCERPT_CHARS = 600
_QUERY_CHARS = 2000


@dataclass(frozen=True)
class Term:
    kind: str
    value: str
    label: str


def classify_clause(text: str) -> str:
    lowered = text.lower()
    best, best_hits = "other", 0
    for clause_type, keywords in CLAUSE_KEYWORDS.items():
        hits = sum(lowered.count(keyword) for keyword in keywords)
        if hits > best_hits:
            best, best_hits = clause_type, hits
    return best


def _days(text: str) -> Term | None:
    match = _DAYS.search(text)
    if not match:
        return None
    unit = f"{match.group(2).lower()} days" if match.group(2) else "days"
    return Term("days", match.group(1), f"{match.group(1)} {unit}")


def _percent(text: str) -> Term | None:
    match = _PERCENT.search(text)
    return Term("percent", match.group(1), f"{match.group(1)}%") if match else None


def _amount(text: str) -> Term | None:
    match = _AMOUNT.search(text)
    return Term("amount", match.group(2), f"{match.group(1)}{match.group(2)}") if match else None


def _jurisdiction(text: str) -> Term | None:
    match = _JURISDICTION.search(text)
    if not match:
        return None
    name = _JURISDICTION_NAMES.get(match.group(1).lower(), match.group(1))
    return Term("jurisdiction", name, name)


def extract_terms(text: str, clause_type: str) -> Term | None:
    extractors = (
        (_jurisdiction, _days, _percent, _amount)
        if clause_type == "governing_law"
        else (_days, _percent, _amount, _jurisdiction)
    )
    for extractor in extractors:
        term = extractor(text)
        if term:
            return term
    return None


def summarise_terms(terms: list[Term | None]) -> list[dict]:
    counts = Counter(term.label for term in terms if term)
    return [
        {"label": label, "count": count}
        for label, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    ]


@dataclass(frozen=True)
class DocumentMeta:
    title: str
    matter_ref: str | None
    date: datetime | None
    author: str | None
    status: str | None


@dataclass(frozen=True)
class PrecedentResult:
    id: str
    source_type: str  # "document" | "knowledge_bank"
    excerpt: str
    document_title: str
    matter_ref: str | None
    date: str | None
    author: str | None
    status: str | None
    document_id: str | None
    term: Term | None


def _load_document_meta(db: Session, document_ids: list[str]) -> dict[str, DocumentMeta]:
    if not document_ids:
        return {}
    documents = list(db.scalars(select(Document).where(Document.id.in_(document_ids))))
    matter_ids = {d.matter_id for d in documents if d.matter_id}
    matters = (
        {m.id: m for m in db.scalars(select(Matter).where(Matter.id.in_(matter_ids)))} if matter_ids else {}
    )
    return {
        d.id: DocumentMeta(
            title=d.filename,
            matter_ref=matters[d.matter_id].case_number if d.matter_id in matters else None,
            date=d.created_at,
            author=d.user.full_name if d.user else None,
            status=d.execution_status,
        )
        for d in documents
    }


def _iso(value: datetime | None) -> str | None:
    return value.date().isoformat() if value else None


async def search_precedents(
    db: Session, *, user: User, text: str, limit: int = 8
) -> tuple[str, list[PrecedentResult]]:
    clause_type = classify_clause(text)
    query = text[:_QUERY_CHARS]
    # Documents: only the user's own or their matters' (document_access_filter inside search_documents).
    chunks = await search_documents(db, query=query, user_id=user.id, limit=limit)
    # KB: matter_id=None excludes matter-scoped entries; other scopes are clean/redacted.
    entries = await search_kb_for_chat(db, user_id=user.id, query=query, matter_id=None, limit=limit)
    meta = _load_document_meta(db, list({c.document_id for c in chunks}))

    results: list[PrecedentResult] = []
    for chunk in chunks:
        info = meta.get(chunk.document_id)
        if not info:
            continue  # no provenance, no suggestion
        results.append(
            PrecedentResult(
                id=chunk.chunk_id,
                source_type="document",
                excerpt=chunk.text[:EXCERPT_CHARS],
                document_title=info.title,
                matter_ref=info.matter_ref,
                date=_iso(info.date),
                author=info.author,
                status=info.status,
                document_id=chunk.document_id,
                term=extract_terms(chunk.text, clause_type),
            )
        )
    for entry in entries:
        results.append(
            PrecedentResult(
                id=entry.id,
                source_type="knowledge_bank",
                excerpt=entry.body_markdown[:EXCERPT_CHARS],
                document_title=entry.title,
                matter_ref="[MATTER]" if entry.matter_id else None,
                date=_iso(entry.updated_at),
                author=entry.creator.full_name if entry.creator else None,
                status=None,
                document_id=None,
                term=extract_terms(entry.body_markdown, clause_type),
            )
        )
    ranked = sorted(enumerate(results), key=lambda item: (item[1].status != "executed", item[0]))
    return clause_type, [result for _, result in ranked][:limit]


def precedent_payload(clause_type: str, results: list[PrecedentResult]) -> dict:
    return {
        "clause_type": clause_type,
        "terms_summary": summarise_terms([r.term for r in results]),
        "results": [
            {
                "id": r.id,
                "source_type": r.source_type,
                "excerpt": r.excerpt,
                "document_title": r.document_title,
                "matter_ref": r.matter_ref,
                "date": r.date,
                "author": r.author,
                "status": r.status,
                "document_id": r.document_id,
                "term": {"kind": r.term.kind, "value": r.term.value, "label": r.term.label} if r.term else None,
            }
            for r in results
        ],
    }
