"""Birdie draft review: structured, anchored suggestions (replace / insert / comment).

The shared draft text, the firm sources the user may see (KB, precedent documents) and any
eLitigation results are sent to the user's OpenRouter model. The model's JSON is validated here:
anchors must exist verbatim in the draft, sources must be ones we supplied, and nothing is applied
until the lawyer accepts it.
"""

import asyncio
import json
import re
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import BirdieReview, BirdieSuggestion, BirdieSuggestionReply, User
from app.services.audit_service import record_retrieval
from app.services.birdie_service import BIRDIE_SYSTEM_PROMPT
from app.services.case_law_service import CaseSource, find_case_sources, validate_case_citations
from app.services.knowledge_bank_service import search_kb_for_chat
from app.services.lesson_service import distill_lessons, list_feedback_rounds
from app.services.llm_service import get_llm
from app.services.precedent_service import search_precedents

TYPES = ("replace", "insert", "comment")
CATEGORIES = ("style", "substance", "question")
STALE_AFTER = timedelta(minutes=10)
MAX_SUGGESTIONS = 60
EXCERPT_CHARS = 700
QUERY_CHARS = 1500

REVIEW_ADDENDUM = """

TASK: DRAFT REVIEW
You are reviewing the draft below. For this task, ignore the OUTPUT section above and return JSON only:
{"suggestions": [{"clause_ref": "3.2" | null, "type": "replace" | "insert" | "comment",
  "anchor_text": "<exact words copied from the draft>", "suggested_text": "<new wording>" | null,
  "reason": "<one line>", "category": "style" | "substance" | "question", "source_ref": "S1" | null}]}

Rules:
- Draft what the style guide and precedent can answer, fix what is mechanical, and ask only about what needs facts or judgement.
- "replace": anchor_text is the words to change; suggested_text replaces them. "insert": anchor_text is where the text goes (for a bracketed placeholder such as [JUNIOR TO DRAFT], the placeholder itself); suggested_text is the new text. "comment": a question or note, suggested_text null.
- category "style" is for mechanical fixes only (shall/will, per cent, and/or, spelling, defined-term formatting). "substance" is for anything that changes legal effect. "question" is for facts or decisions you cannot supply.
- Copy anchor_text exactly, character for character. One suggestion per point; do not overlap anchors.
- Every substance suggestion needs a source_ref from the numbered sources below. If no source supports it, make it a comment that asks for the missing information. Never invent a source.
- Use amounts, not percentages, when the consideration is stated in the draft (work out the figure).
- Never introduce a defined term the draft does not define.
- Do not suggest anything the draft already does correctly. No generic checklists: ask for the specific missing information.
- Lessons from the user's reviewers are standing instructions: check the draft against every lesson and flag each breach, citing the lesson as source_ref. A lesson is enough source for a substance suggestion.
- Hedge at most once in a sentence. Keep each reason to one line.
"""


class ReviewError(RuntimeError):
    pass


# ---------------------------------------------------------------- pure helpers


def parse_suggestions(raw: str) -> list[dict]:
    match = re.search(r"\{.*\}", raw, re.S)
    if not match:
        return []
    try:
        payload = json.loads(match.group(0))
    except ValueError:
        return []
    items = payload.get("suggestions") if isinstance(payload, dict) else None
    return [i for i in items if isinstance(i, dict)] if isinstance(items, list) else []


def find_anchor(text: str, anchor: str, clause_ref: str | None = None) -> tuple[int, int] | None:
    """Locate anchor in text. Whitespace-insensitive; prefers the occurrence after the clause heading."""
    anchor = anchor.strip()
    if not anchor:
        return None
    pattern = re.compile(r"\s+".join(re.escape(part) for part in anchor.split()))
    spans = [m.span() for m in pattern.finditer(text)]
    if not spans:
        return None
    if clause_ref and len(spans) > 1:
        heading = re.search(rf"(?m)^\s*{re.escape(clause_ref)}[\s.)]", text)
        if heading:
            after = [s for s in spans if s[0] >= heading.start()]
            if after:
                return after[0]
    return spans[0]


_TERM = re.compile(r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b")


def undefined_terms(suggested: str, draft: str, extra: str = "") -> list[str]:
    """Capitalised multi-word terms in suggested text that appear nowhere in the draft or sources."""
    haystack = f"{draft}\n{extra}"
    return sorted({t for t in _TERM.findall(suggested) if t not in haystack})


def apply_edit(text: str, s: BirdieSuggestion) -> tuple[int, int, str] | None:
    """(start, end, replacement) for an accepted suggestion, or None for comments."""
    if s.type == "comment" or s.suggested_text is None:
        return None
    if s.type == "replace":
        return s.anchor_start, s.anchor_end, s.suggested_text
    anchor = text[s.anchor_start : s.anchor_end]
    if anchor.startswith("[") and anchor.endswith("]"):
        return s.anchor_start, s.anchor_end, s.suggested_text
    return s.anchor_end, s.anchor_end, "\n" + s.suggested_text


def current_text(review: BirdieReview) -> str:
    """The draft with every accepted suggestion applied (anchors are non-overlapping)."""
    text = review.source_text
    edits = [
        e for s in review.suggestions if s.status == "accepted" and (e := apply_edit(text, s))
    ]
    for start, end, replacement in sorted(edits, key=lambda e: e[0], reverse=True):
        text = text[:start] + replacement + text[end:]
    return text


def build_suggestions(
    raw_items: list[dict],
    *,
    text: str,
    sources: dict[str, dict],
    cases: list[CaseSource],
    source_blob: str,
) -> tuple[list[dict], dict]:
    """Validate model output. Returns (suggestion dicts ready to store, stats)."""
    stats = {"dropped_anchor": 0, "dropped_term": 0, "dropped_citation": 0, "downgraded": 0}
    accepted: list[dict] = []
    taken: list[tuple[int, int]] = []
    suggested_texts = [str(i.get("suggested_text") or "") for i in raw_items]

    for index, item in enumerate(raw_items[:MAX_SUGGESTIONS]):
        kind = item.get("type")
        category = item.get("category")
        anchor = str(item.get("anchor_text") or "")
        reason = " ".join(str(item.get("reason") or "").split())
        if kind not in TYPES or category not in CATEGORIES or not reason:
            continue
        span = find_anchor(text, anchor, item.get("clause_ref"))
        if span is None:
            stats["dropped_anchor"] += 1
            continue
        if any(span[0] < e and s < span[1] for s, e in taken):
            continue
        suggested = item.get("suggested_text")
        suggested = str(suggested) if suggested and kind != "comment" else None
        if kind != "comment" and not suggested:
            continue

        source = sources.get(str(item.get("source_ref") or ""))
        if suggested:
            if validate_case_citations(f"{suggested}\n{reason}", cases):
                stats["dropped_citation"] += 1
                continue
            # A term may be defined by another suggestion (e.g. "Escrow Agent" added to clause 1.1).
            others = "\n".join(t for i, t in enumerate(suggested_texts) if i != index)
            if kind == "replace" and undefined_terms(suggested, text, f"{source_blob}\n{others}"):
                # A term the draft never defines: drop rather than put it in front of the lawyer.
                stats["dropped_term"] += 1
                continue
        if category == "substance" and kind != "comment" and source is None:
            kind, suggested, category = "comment", None, "question"
            reason = f"Unsourced, please confirm: {reason}"
            stats["downgraded"] += 1

        taken.append(span)
        accepted.append(
            {
                "clause_ref": (str(item["clause_ref"])[:40] if item.get("clause_ref") else None),
                "anchor_text": text[span[0] : span[1]],
                "anchor_start": span[0],
                "anchor_end": span[1],
                "type": kind,
                "suggested_text": suggested,
                "reason": reason,
                "category": category,
                "source": source,
            }
        )
    return accepted, stats


# ---------------------------------------------------------------- retrieval

_HEADING = re.compile(r"(?m)^\s*(\d{1,2})\.\s+([A-Z][A-Z0-9 ,'&/()-]{3,})\s*$")
MAX_CLAUSE_QUERIES = 14
MIN_CLAUSE_CHARS = 80
CLAUSE_QUERY_CHARS = 700
SOURCES_PER_CLAUSE = 3
MAX_SOURCES = 24
STYLE_GUIDE_QUERY = "style guide drafting conventions and buyer-side or seller-side positions"


def split_clauses(text: str) -> list[tuple[str, str]]:
    """Top-level numbered, upper-case headings -> [(heading, body)]. Used to search per clause."""
    marks = list(_HEADING.finditer(text))
    clauses = []
    for i, m in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
        body = text[m.end():end].strip()
        if len(body) >= MIN_CLAUSE_CHARS:
            clauses.append((f"{m.group(1)}. {m.group(2).title()}", body))
    return clauses


def _same_document(title: str, review_title: str | None) -> bool:
    """The draft under review is often uploaded too; it must not cite itself."""
    def norm(value: str) -> str:
        value = re.sub(r"\s*-\s*google docs$", "", value.strip().lower())
        return re.sub(r"\.(docx?|pdf)$", "", value)

    return bool(review_title) and norm(title) == norm(review_title)


async def gather_firm_sources(db: Session, *, user: User, review: BirdieReview):
    """Per-clause precedent search plus the style guide, deduplicated, excluding the draft itself."""
    text = review.source_text
    clauses = split_clauses(text)[:MAX_CLAUSE_QUERIES] or [("Draft", text[:QUERY_CHARS])]
    searches = [
        search_precedents(db, user=user, text=f"{head}\n{body[:CLAUSE_QUERY_CHARS]}", limit=SOURCES_PER_CLAUSE)
        for head, body in clauses
    ]
    style = search_kb_for_chat(
        db, user_id=user.id, query=STYLE_GUIDE_QUERY, matter_id=review.matter_id, limit=4
    )
    *per_clause, style_entries = await asyncio.gather(*searches, style)
    seen: set[str] = set()
    precedents = []
    for _clause_type, results in per_clause:
        for r in results:
            if r.id in seen or _same_document(r.document_title, review.title):
                continue
            seen.add(r.id)
            precedents.append(r)
    return precedents[:MAX_SOURCES], list(style_entries)


# ---------------------------------------------------------------- sources


MAX_LESSON_SOURCES = 12


async def gather_lessons(db: Session, *, user: User) -> list[dict]:
    """Lessons from the user's own returned review rounds (submitter only).

    A round nobody has distilled yet is distilled here; if that fails, the reviewer's raw
    comments stand in, so the draft is still checked against them.
    """
    lessons: list[dict] = []
    for r in list_feedback_rounds(db, user=user, limit=5):
        who = r.reviewer_name or "your reviewer"
        date = r.date.date().isoformat()
        stored = r.lessons
        if not stored:
            try:
                stored = await distill_lessons(db, user=user, handoff_id=r.handoff_id)
            except Exception:  # noqa: BLE001 - fall back to the comments themselves
                db.rollback()
                stored = []
        for lesson in stored:
            lessons.append(
                {"title": f"{lesson.title} (from {who}, {r.document_name})", "body": lesson.body,
                 "date": date}
            )
        if not stored:
            for a in r.annotations:
                body = "; ".join(
                    part for part in (
                        f'changed "{a.anchor_quote}"' if a.anchor_quote else "",
                        f'to "{a.suggested_text}"' if a.suggested_text else "",
                        f"because: {a.note}" if a.note else "",
                    ) if part
                )
                lessons.append(
                    {"title": f"Comment from {who} on {r.document_name}", "body": body, "date": date}
                )
    return lessons[:MAX_LESSON_SOURCES]


def _collect_sources(
    precedents, kb_entries, cases: list[CaseSource], lessons: list[dict] | None = None
) -> tuple[dict[str, dict], str]:
    """Number every source the model may cite. Returns ({ref: payload}, prompt block)."""
    sources: dict[str, dict] = {}
    lines: list[str] = []

    def add(payload: dict, excerpt: str) -> None:
        ref = f"S{len(sources) + 1}"
        sources[ref] = payload
        meta = ", ".join(
            f"{k}: {payload[k]}" for k in ("status", "side", "date", "matter_ref") if payload.get(k)
        )
        lines.append(f"[{ref}] ({payload['kind']}) {payload['title']}" + (f" ({meta})" if meta else ""))
        lines.append(f"    {excerpt[:EXCERPT_CHARS]}")

    for lesson in lessons or []:
        add({"kind": "lesson", "title": lesson["title"], "date": lesson["date"]}, lesson["body"])

    seen: set[str] = set()
    for r in precedents:
        if r.source_type == "knowledge_bank":
            seen.add(r.id)
            add(
                {"kind": "kb", "id": r.id, "title": r.document_title, "path": f"/knowledge-bank/{r.id}",
                 "date": r.date, "matter_ref": r.matter_ref},
                r.excerpt,
            )
        elif r.document_id:
            add(
                {"kind": "document", "id": r.document_id, "title": r.document_title,
                 "path": f"/documents/{r.document_id}", "status": r.status, "date": r.date,
                 "matter_ref": r.matter_ref},
                r.excerpt,
            )
    for e in kb_entries:
        if e.id in seen:
            continue
        add(
            {"kind": "style_guide" if e.entry_type == "style_guide" else "kb", "id": e.id,
             "title": e.title, "path": f"/knowledge-bank/{e.id}"},
            e.body_markdown,
        )
    for c in cases:
        add(
            {"kind": "elitigation", "title": f"{c.citation} {c.title}", "url": c.url,
             "date": c.decision_date},
            " ".join(text for _n, text in c.paragraphs) or c.title,
        )
    return sources, "\n".join(lines)


# ---------------------------------------------------------------- job


def create_review(
    db: Session, *, user: User, url: str, title: str | None, text: str,
    matter_id: str | None, model: str,
) -> BirdieReview:
    review = BirdieReview(
        user_id=user.id, matter_id=matter_id, source_url=url, title=title,
        source_text=text, model=model, status="processing", stats={},
    )
    db.add(review)
    db.commit()
    db.refresh(review)
    return review


async def run_review(review_id: str) -> None:
    """Background job: gather sources, ask the model, validate, store."""
    db = SessionLocal()
    try:
        review = db.get(BirdieReview, review_id)
        if review is None or review.status != "processing":
            return
        user = db.get(User, review.user_id)
        try:
            text = review.source_text
            precedents, kb_entries = await gather_firm_sources(db, user=user, review=review)
            llm = get_llm(db, user.id, feature="birdie_review", model=review.model)
            cases = await find_case_sources(
                db, user=user, provider=llm,
                user_message="Review this draft; find Singapore judgments only if the draft turns on a point of law.",
                web_text=text,
            )
            lessons = await gather_lessons(db, user=user)
            sources, block = _collect_sources(precedents, kb_entries, cases, lessons)
            messages = [
                {"role": "system", "content": BIRDIE_SYSTEM_PROMPT + REVIEW_ADDENDUM},
                {"role": "user", "content": f"Sources:\n{block or '(none found)'}\n\nDraft:\n{text}"},
            ]
            db.rollback()  # release the read transaction before the slow model call
            raw = await llm.complete(messages)
            items, stats = build_suggestions(
                parse_suggestions(raw), text=text, sources=sources, cases=cases, source_blob=block
            )
            review = db.get(BirdieReview, review_id)
            for item in items:
                review.suggestions.append(BirdieSuggestion(**item))
            review.stats = {**stats, "total": len(items)}
            review.status = "ready"
            record_retrieval(
                db, user_id=user.id, kind="birdie_review", query=review.source_url,
                returned_ids=[s["id"] for s in sources.values() if s.get("id")],
            )
            db.commit()
        except Exception as exc:  # noqa: BLE001 - the job must always end ready or failed
            db.rollback()
            review = db.get(BirdieReview, review_id)
            review.status = "failed"
            review.error = str(exc) if isinstance(exc, (ReviewError, RuntimeError)) else "Review failed"
            db.commit()
    finally:
        db.close()


def expire_stale(review: BirdieReview) -> None:
    created = review.created_at
    if review.status == "processing" and created and datetime.now(UTC) - created > STALE_AFTER:
        review.status = "failed"
        review.error = "Review timed out"


# ---------------------------------------------------------------- reads / decisions


def get_review(db: Session, review_id: str, user_id: str) -> BirdieReview | None:
    review = db.scalar(
        select(BirdieReview).where(BirdieReview.id == review_id, BirdieReview.user_id == user_id)
    )
    if review:
        expire_stale(review)
        db.commit()
    return review


def latest_review_for_url(db: Session, url: str, user_id: str) -> BirdieReview | None:
    review = db.scalar(
        select(BirdieReview)
        .where(BirdieReview.user_id == user_id, BirdieReview.source_url == url)
        .order_by(BirdieReview.created_at.desc())
        .limit(1)
    )
    if review:
        expire_stale(review)
        db.commit()
    return review


def reset_reviews_for_url(db: Session, url: str, user_id: str) -> int:
    """Delete the user's own reviews of this page (suggestions and replies cascade)."""
    reviews = db.scalars(
        select(BirdieReview).where(BirdieReview.user_id == user_id, BirdieReview.source_url == url)
    ).all()
    for review in reviews:
        db.delete(review)
    db.commit()
    return len(reviews)


def get_suggestion(db: Session, suggestion_id: str, user_id: str) -> BirdieSuggestion | None:
    return db.scalar(
        select(BirdieSuggestion)
        .join(BirdieReview, BirdieReview.id == BirdieSuggestion.review_id)
        .where(BirdieSuggestion.id == suggestion_id, BirdieReview.user_id == user_id)
    )


def decide(db: Session, suggestion: BirdieSuggestion, user_id: str, status: str) -> BirdieSuggestion:
    suggestion.status = status
    suggestion.decided_by = user_id if status != "pending" else None
    suggestion.decided_at = datetime.now(UTC) if status != "pending" else None
    record_retrieval(
        db, user_id=user_id, kind="suggestion_decision",
        query=f"{status}:{suggestion.type}:{suggestion.category}", returned_ids=[suggestion.id],
    )
    db.commit()
    db.refresh(suggestion)
    return suggestion


def accept_style_fixes(db: Session, review: BirdieReview, user_id: str) -> int:
    """Bulk accept: mechanical style replacements only. Substance is never bulk-accepted."""
    count = 0
    for s in review.suggestions:
        if s.status == "pending" and s.type == "replace" and s.category == "style":
            s.status, s.decided_by, s.decided_at = "accepted", user_id, datetime.now(UTC)
            count += 1
    if count:
        record_retrieval(
            db, user_id=user_id, kind="suggestion_decision",
            query=f"bulk_accepted_style:{count}",
            returned_ids=[s.id for s in review.suggestions if s.status == "accepted" and s.category == "style"],
        )
    db.commit()
    return count


def add_reply(db: Session, suggestion: BirdieSuggestion, user_id: str, body: str) -> BirdieSuggestionReply:
    reply = BirdieSuggestionReply(suggestion_id=suggestion.id, author_user_id=user_id, body=body.strip())
    db.add(reply)
    db.commit()
    db.refresh(reply)
    return reply
