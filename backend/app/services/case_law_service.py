"""Grounds Birdie's case law in eLitigation: Birdie may only cite judgments found there.

The planning prompt (user message + up to 2,000 chars of shared web text) goes to the user's Birdie
provider; only the resulting search phrase goes to eLitigation.
"""

import asyncio
import json
import re
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.models import User
from app.services.audit_service import record_retrieval
from app.services.elitigation_service import (
    ElitigationError,
    JudgmentExcerpt,
    fetch_judgment_excerpt,
    search_judgments,
)

CASE_LAW_RULE = (
    "Case law rule: only cite cases listed under 'eLitigation sources'. Copy each citation exactly and "
    "link its URL. If no source is listed or none supports the point, say you couldn't find a supporting "
    "case on eLitigation. Never cite a case from memory."
)

_PLANNER_PROMPT = (
    "Decide whether answering the user's message needs Singapore case law or court judgments. "
    'Reply with JSON only: {"search": "<3-8 word eLitigation search phrase>"} or {"search": null}. '
    "Build the phrase from the legal issues and doctrines in the message and any shared text, not from "
    "party names, client facts or the user's wording about their own documents (for example 'what builds on "
    "our files'). The phrase is sent to a public court database."
)

_NEUTRAL_CITATION = re.compile(r"\[\d{4}\]\s+SG[A-Z]+\s+\d+")
_JSON_OBJECT = re.compile(r"\{.*\}", re.S)
EXCERPT_JUDGMENTS = 3
# A judgment the user is reading on eLitigation is a verified source; its neutral citation is in the URL.
_PAGE_JUDGMENT = re.compile(r"^https://www\.elitigation\.sg/gd/s/(\d{4})_(SGCA|SGHC|SGHCF|SGHCR|SGDC|SGMC|SGFC)_(\d+)/?(?:[?#].*)?$")


@dataclass(frozen=True)
class CaseSource:
    citation: str
    title: str
    decision_date: str | None
    url: str
    paragraphs: list[tuple[str, str]]


def page_case_source(url: str, title: str | None) -> CaseSource | None:
    """The eLitigation judgment open in the user's browser, so it can be cited like a search result."""
    match = _PAGE_JUDGMENT.match(url.strip())
    if not match:
        return None
    year, court, number = match.groups()
    clean_url = url.strip().split("#")[0].split("?")[0].rstrip("/")
    return CaseSource(f"[{year}] {court} {number}", (title or "").strip() or "Judgment on this page", None, clean_url, [])


def with_page_source(sources: list[CaseSource], page: CaseSource | None) -> list[CaseSource]:
    if not page or any(_normalise_citation(s.citation) == page.citation for s in sources):
        return sources
    return [page, *sources]


def _normalise_citation(citation: str) -> str:
    return " ".join(citation.split())


def parse_search_phrase(raw: str) -> str | None:
    match = _JSON_OBJECT.search(raw)
    if not match:
        return None
    try:
        payload = json.loads(match.group(0))
    except ValueError:
        return None
    phrase = payload.get("search") if isinstance(payload, dict) else None
    if not isinstance(phrase, str) or not phrase.strip():
        return None
    return phrase.strip()[:200]


async def _plan_search(provider, user_message: str, web_text: str) -> str | None:
    # A long judgment states its issues in the first pages; sample enough of it to name them.
    content = user_message if not web_text else f"{user_message}\n\nShared text:\n{web_text[:6000]}"
    try:
        raw = await provider.complete(
            [{"role": "system", "content": _PLANNER_PROMPT}, {"role": "user", "content": content}]
        )
    except Exception as exc:
        print(f"Case-law planner skipped: {exc!r}")
        return None
    return parse_search_phrase(raw)


async def find_case_sources(
    db: Session,
    *,
    user: User,
    provider,
    user_message: str,
    web_text: str,
) -> list[CaseSource]:
    phrase = await _plan_search(provider, user_message, web_text)
    if not phrase:
        return []
    try:
        return await search_case_sources(db, user=user, query=phrase)
    except ElitigationError as exc:
        print(f"eLitigation search failed: {exc}")
        return []


async def search_case_sources(
    db: Session, *, user: User, query: str, newest_first: bool = False,
    year: int | None = None,
) -> list[CaseSource]:
    """Shared lookup for Birdie and LexChat; search failures remain explicit to callers."""
    judgments = await search_judgments(query, limit=5, newest_first=newest_first, year=year)
    excerpts = await asyncio.gather(
        *(fetch_judgment_excerpt(j, query) for j in judgments[:EXCERPT_JUDGMENTS]),
        return_exceptions=True,
    )
    paragraphs_by_url = {
        e.judgment.url: e.paragraphs for e in excerpts if isinstance(e, JudgmentExcerpt)
    }
    sources = [
        CaseSource(j.citation, j.title, j.decision_date, j.url, paragraphs_by_url.get(j.url, []))
        for j in judgments
    ]
    record_retrieval(
        db, user_id=user.id, kind="case_search", query=query, returned_ids=[s.citation for s in sources]
    )
    return sources


def format_case_sources(sources: list[CaseSource]) -> str:
    if not sources:
        return ""
    lines = ["\n\n---\neLitigation sources (the ONLY cases you may cite):"]
    for index, source in enumerate(sources, start=1):
        decided = f", decided {source.decision_date}" if source.decision_date else ""
        lines.append(f"[{index}] {source.citation} — {source.title}{decided} — {source.url}")
        lines.extend(f"  [para {number}] {text}" for number, text in source.paragraphs)
    return "\n".join(lines)


def validate_case_citations(answer: str, sources: list[CaseSource]) -> str | None:
    allowed = {_normalise_citation(s.citation) for s in sources}
    unknown = sorted({_normalise_citation(c) for c in _NEUTRAL_CITATION.findall(answer)} - allowed)
    if not unknown:
        return None
    return (
        f"\n\n> ⚠️ Not found in the eLitigation results for this answer: {', '.join(unknown)}. "
        "Do not rely on these citations."
    )


def case_source_payload(source: CaseSource) -> dict:
    return {
        "citation": source.citation,
        "title": source.title,
        "decision_date": source.decision_date,
        "url": source.url,
    }
