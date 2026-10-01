"""Seed a believable demo firm. Everything here is synthetic.

Resets are scoped to demo rows only: the dummy users' content, the demo team and matter, and
knowledge-bank entries tagged ``demo-seed``. The presenter's own data is never touched.

External services: documents go through the normal upload pipeline (R2 + worker + OpenAI
embeddings) and KB entries are embedded, so those must be configured for citations and search to
work. Failures there are reported in the summary rather than aborting the seed.
"""

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.models import (
    ActionItem,
    ChatMessage,
    ChatThread,
    Document,
    KnowledgeBankEntry,
    Matter,
    MatterMember,
    Memory,
    ReviewAnnotation,
    ReviewHandoff,
    SurveyQuestion,
    SurveyResponse,
    Team,
    TeamMember,
    User,
    WikiLink,
    WikiPage,
)
from app.schemas import KnowledgeBankEntryCreate, WikiPageCreate
from app.services import document_service, knowledge_bank_service, wiki_service
from app.services.demo_pdfs import DISCLOSURE_BLOCKS, NDA_BLOCKS, SPA_BLOCKS, DemoPdf
from app.services.resource_metadata_service import (
    RESOURCE_ACTION_ITEM,
    RESOURCE_DOCUMENT,
    RESOURCE_KB_ENTRY,
    RESOURCE_REVIEW_HANDOFF,
    RESOURCE_WIKI_PAGE,
    delete_resource_metadata,
    sync_action_metadata,
    sync_handoff_metadata,
    sync_metadata_safe,
)
from app.services.storage_service import StorageError, delete_document_file
from app.services.survey_service import current_week_start, seed_survey_questions
from app.services.user_service import create_dummy_users

_log = logging.getLogger(__name__)

DEMO_TEAM = "Corporate (Demo)"
DEMO_CASE = "DEMO-MERIDIAN-001"
DEMO_MATTER_TITLE = "Meridian Capital — Share Purchase"
DEMO_TAG = "demo-seed"
SPA_TICKET = "SPA extract — indemnities"

# --- Round 1: Sarah's comments on Jane's NDA --------------------------------------------------
# (quote, kind, suggested wording, note, status)
NDA_FEEDBACK = [
    (
        "shall indemnify the Disclosing Party against all losses arising from any breach of this Agreement, without limit",
        "suggestion",
        "shall indemnify the Disclosing Party against direct losses arising from any breach of this Agreement, up to an aggregate cap equal to the fees paid under this Agreement",
        "Uncapped indemnities are off-market for an NDA and expose the client to open-ended liability. Our position: cap at fees paid and limit to direct losses.",
        "needs_rework",
    ),
    (
        "laws of the State of New York",
        "suggestion",
        "laws of England and Wales",
        "Meridian is UK-incorporated and the target is a UK company. We do not accept New York law on a UK deal; default to English law.",
        "needs_rework",
    ),
    (
        "Proprietary Information",
        "suggestion",
        "Confidential Information",
        "Use the defined term exactly as defined in clause 1. Switching to a different label creates doubt about what is covered.",
        "open",
    ),
    (
        "The parties hereby agree and do hereby acknowledge that",
        "suggestion",
        "The parties agree that",
        "Plain English: drop 'hereby' and 'do hereby'. Our style guide prefers short, direct drafting.",
        "open",
    ),
]

KB_ENTRIES = [
    (
        "firm_wide",
        "style_guide",
        "Firm style guide: defined terms and plain English",
        "## Defined terms\n\n- Define a term once, in clause 1 or the definitions schedule, and use it exactly thereafter.\n- Never introduce a second label for the same thing (for example *Proprietary Information* alongside *Confidential Information*).\n\n## Plain English\n\n- Prefer *agree* to *hereby agree and do hereby acknowledge*.\n- One idea per sentence. Avoid *aforesaid*, *hereinafter*, *witnesseth*.\n\n## Numbering\n\n- Clauses 1, 2, 3; sub-clauses 1.1, 1.2; paragraphs (a), (b).",
        ["style", "drafting"],
    ),
    (
        "firm_wide",
        "knowledge_bank",
        "Playbook: indemnity caps",
        "## Standard position\n\nIndemnities in NDAs and commercial agreements are capped at the fees paid or payable under the agreement, and limited to direct losses.\n\n## Why\n\nUncapped indemnities create open-ended exposure and are rarely accepted by insurers.\n\n## Fallbacks\n\n- Cap at the greater of fees paid and GBP 1 million where the counterparty insists.\n- Never agree to an uncapped indemnity without partner sign-off.",
        ["playbook", "indemnity"],
    ),
    (
        "firm_wide",
        "knowledge_bank",
        "Playbook: governing law and jurisdiction",
        "## Standard position\n\nFor UK-incorporated clients and UK targets, use English law and the courts of England and Wales.\n\n## Fallbacks\n\n- A neutral law (for example Singapore) may be accepted for cross-border deals with partner approval.\n- Do not accept the law of a US state on a UK transaction.",
        ["playbook", "governing-law"],
    ),
    (
        "firm_wide",
        "knowledge_bank",
        "Playbook: limitation of liability and baskets",
        "## Baskets\n\nPrefer a **tipping** basket (once the threshold is crossed, liability runs from the first pound). A **deductible** basket removes the threshold from every claim and favours the sellers.\n\n## Caps\n\nOverall liability should not exceed the purchase price; warranty claims are usually capped lower.",
        ["playbook", "spa", "limitation"],
    ),
    (
        "matter",
        "knowledge_bank",
        "Meridian: client preferences",
        "- Client wants plain-English drafts and short turnaround.\n- Deal lead: Meridian General Counsel. Escalate indemnity and governing-law points to the partner.\n- Target is UK-incorporated; English law throughout.",
        ["meridian", "client"],
    ),
]

TICKETS = [
    # (title, description, status, priority, due offset days, assignee key)
    (
        "Revise Meridian NDA after Sarah's comments",
        "Apply Sarah's redlines: cap the indemnity, move to English law, fix the defined term.",
        "in_progress",
        "high",
        1,
        "jane",
    ),
    (
        SPA_TICKET,
        "First pass on clauses 7 and 12 of the SPA extract. Review ready for Sarah.",
        "review",
        "high",
        2,
        "jane",
    ),
    (
        "Prepare disclosure letter schedules",
        "Draft Schedules 1 and 2 from the data room index.",
        "pending",
        "medium",
        5,
        "jane",
    ),
    (
        "Update closing checklist",
        "Reflect the latest signing timetable from the client.",
        "done",
        "low",
        -2,
        "jane",
    ),
    (
        "Research UK position on warranty baskets",
        "One-page note on tipping versus deductible baskets for the partner.",
        "pending",
        "medium",
        7,
        "marcus",
    ),
]

JANE_MEMORIES = [
    ("semantic", "I am a first-year associate working on the Meridian Capital share purchase."),
    ("semantic", "My supervising senior associate is Sarah Chen."),
    ("procedural", "I prefer concise answers with the clause reference first."),
    ("episodic", "Sarah flagged an uncapped indemnity in my NDA draft this week."),
]

# Agreement scores 1-5 per week (oldest first). Workload / mental-health items are bad when high;
# team-dynamics / learning items are reverse scored (good when high).
SURVEY_PATTERNS = {
    "jane": {"pressure": [3, 4, 5, 5, 4, 3], "support": [4, 3, 2, 2, 3, 4]},
    "sarah": {"pressure": [3, 3, 4, 3, 3, 3], "support": [4, 4, 3, 4, 4, 4]},
    "marcus": {"pressure": [2, 3, 3, 3, 2, 2], "support": [4, 4, 4, 3, 4, 4]},
}

WIKI_PAGES = [
    (
        "Meridian share purchase: overview",
        "source_summary",
        "# Meridian share purchase\n\nMeridian Capital Ltd is buying Oaktree Holdings Ltd. See [[Parties and roles]] and [[Key risks]].\n\n- NDA signed and under revision\n- SPA indemnity and governing-law points open",
    ),
    (
        "Parties and roles",
        "entity",
        "# Parties and roles\n\n- **Buyer:** Meridian Capital Ltd (client)\n- **Target:** Oaktree Holdings Ltd\n- **Our team:** Sarah Chen (senior associate), Jane Pereira (associate)",
    ),
    (
        "Key risks",
        "issue",
        "# Key risks\n\n1. Uncapped indemnity in the NDA\n2. New York governing law on a UK deal\n3. Deductible basket in the SPA favours sellers",
    ),
]


class DemoSeedError(RuntimeError):
    pass


def reset_demo(db: Session, *, presenter: User, demo_user_ids: list[str]) -> None:
    """Delete previously seeded demo content. Keeps the dummy users themselves."""
    matter = db.scalar(select(Matter).where(Matter.case_number == DEMO_CASE))
    team = db.scalar(select(Team).where(Team.name == DEMO_TEAM))
    matter_id = matter.id if matter else None

    # Actions and handoffs reference each other; break the cycle first.
    action_filter = (
        ActionItem.assignee_id.in_(demo_user_ids)
        | ActionItem.assigner_id.in_(demo_user_ids)
        | (ActionItem.matter_id == matter_id if matter_id else ActionItem.id.is_(None))
    )
    action_ids = list(db.scalars(select(ActionItem.id).where(action_filter)))
    handoff_filter = ReviewHandoff.submitted_by.in_(demo_user_ids) | (
        ReviewHandoff.matter_id == matter_id if matter_id else ReviewHandoff.id.is_(None)
    )
    handoff_ids = list(db.scalars(select(ReviewHandoff.id).where(handoff_filter)))
    if action_ids:
        db.execute(
            update(ActionItem).where(ActionItem.id.in_(action_ids)).values(active_handoff_id=None)
        )
    db.flush()
    for handoff in db.scalars(select(ReviewHandoff).where(ReviewHandoff.id.in_(handoff_ids))):
        delete_resource_metadata(db, resource_type=RESOURCE_REVIEW_HANDOFF, resource_id=handoff.id)
        db.delete(handoff)
    for action in db.scalars(select(ActionItem).where(ActionItem.id.in_(action_ids))):
        delete_resource_metadata(db, resource_type=RESOURCE_ACTION_ITEM, resource_id=action.id)
        db.delete(action)
    db.flush()

    storage_keys: list[str] = []
    for document in db.scalars(select(Document).where(Document.user_id.in_(demo_user_ids))):
        if document.storage_key:
            storage_keys.append(document.storage_key)
        delete_resource_metadata(db, resource_type=RESOURCE_DOCUMENT, resource_id=document.id)
        db.delete(document)

    creators = [presenter.id, *demo_user_ids]
    for entry in db.scalars(
        select(KnowledgeBankEntry).where(KnowledgeBankEntry.created_by.in_(creators))
    ):
        if DEMO_TAG in (entry.tags or []):
            delete_resource_metadata(db, resource_type=RESOURCE_KB_ENTRY, resource_id=entry.id)
            db.delete(entry)

    wiki_filter = WikiPage.owner_user_id.in_(demo_user_ids)
    for page in db.scalars(select(WikiPage).where(wiki_filter)):
        delete_resource_metadata(db, resource_type=RESOURCE_WIKI_PAGE, resource_id=page.id)
        db.execute(delete(WikiLink).where(WikiLink.source_page_id == page.id))
        db.execute(delete(WikiLink).where(WikiLink.target_page_id == page.id))
        db.delete(page)

    for thread in db.scalars(select(ChatThread).where(ChatThread.user_id.in_(demo_user_ids))):
        db.delete(thread)
    for memory in db.scalars(select(Memory).where(Memory.user_id.in_(demo_user_ids))):
        db.delete(memory)
    db.execute(delete(SurveyResponse).where(SurveyResponse.user_id.in_(demo_user_ids)))

    if matter:
        db.execute(delete(MatterMember).where(MatterMember.matter_id == matter.id))
        db.delete(matter)
        db.flush()
    if team:
        db.execute(update(User).where(User.default_team_id == team.id).values(default_team_id=None))
        db.execute(delete(TeamMember).where(TeamMember.team_id == team.id))
        db.delete(team)
    db.commit()

    for key in storage_keys:
        try:
            delete_document_file(key)
        except StorageError as exc:
            _log.warning("Demo reset: storage delete skipped (%s)", exc)


async def seed_demo(db: Session, *, presenter: User) -> dict:
    users = {u.google_id.split(":", 1)[1].split("-")[0]: u for u in create_dummy_users(db)}
    sarah, jane, marcus = users["sarah"], users["jane"], users["marcus"]
    demo_ids = [u.id for u in users.values()]

    reset_demo(db, presenter=presenter, demo_user_ids=demo_ids)
    db.refresh(presenter)

    summary: dict = {"documents": 0, "documents_failed": 0, "kb_entries": 0, "kb_failed": 0}

    # Team + matter ---------------------------------------------------------------------------
    team = Team(name=DEMO_TEAM, practice_area="Corporate / M&A")
    db.add(team)
    db.flush()
    for user in (presenter, sarah, jane, marcus):
        db.add(TeamMember(team_id=team.id, user_id=user.id, role=user.firm_role))
    for user in (sarah, jane, marcus):
        user.default_team_id = team.id
    matter = Matter(team_id=team.id, title=DEMO_MATTER_TITLE, case_number=DEMO_CASE)
    matter.client_name = "Meridian Capital Ltd"
    db.add(matter)
    db.flush()
    for user in (presenter, sarah, jane):
        db.add(
            MatterMember(
                matter_id=matter.id, user_id=user.id, role=user.firm_role, granted_by=presenter.id
            )
        )
    db.commit()

    # Documents (owned by Jane, processed by the normal worker) -------------------------------
    nda_pdf, spa_pdf = DemoPdf(NDA_BLOCKS), DemoPdf(SPA_BLOCKS)
    docs: dict[str, Document] = {}
    for key, filename, pdf_bytes in (
        ("nda", "Meridian NDA.pdf", nda_pdf.bytes),
        ("spa", "SPA extract.pdf", spa_pdf.bytes),
        ("disclosure", "Disclosure letter.pdf", DemoPdf(DISCLOSURE_BLOCKS).bytes),
    ):
        document = await document_service.create_pending_document(
            db,
            user_id=jane.id,
            filename=filename,
            content_type="application/pdf",
            file_bytes=pdf_bytes,
            matter_id=matter.id,
            team_id=team.id,
        )
        docs[key] = document
        if document.status == "failed":
            summary["documents_failed"] += 1
            _log.warning("Demo document %s failed: %s", filename, document.error_message)
        else:
            summary["documents"] += 1

    # Knowledge Bank ---------------------------------------------------------------------------
    for scope, entry_type, title, body, tags in KB_ENTRIES:
        try:
            await knowledge_bank_service.create_kb_entry(
                db,
                user=presenter,
                schema=KnowledgeBankEntryCreate(
                    scope=scope,
                    entry_type=entry_type,
                    title=title,
                    body_markdown=body,
                    tags=[*tags, DEMO_TAG],
                    matter_id=matter.id if scope == "matter" else None,
                ),
            )
            summary["kb_entries"] += 1
        except Exception as exc:  # embedding / provider failures should not abort the seed
            db.rollback()
            summary["kb_failed"] += 1
            _log.warning("Demo KB entry %r failed: %s", title, exc)

    # Workboard + review rounds ----------------------------------------------------------------
    now = datetime.now(UTC)
    assignees = {"jane": jane, "marcus": marcus}
    actions: dict[str, ActionItem] = {}
    for title, description, status, priority, due_days, assignee_key in TICKETS:
        action = ActionItem(
            title=title,
            description=description,
            assignee_id=assignees[assignee_key].id,
            assigner_id=sarah.id,
            matter_id=matter.id,
            due_date=now + timedelta(days=due_days),
            status=status,
            priority=priority,
            tags=[],
        )
        db.add(action)
        actions[title] = action
    db.flush()

    nda_action = actions["Revise Meridian NDA after Sarah's comments"]
    spa_action = actions[SPA_TICKET]
    round1 = ReviewHandoff(
        action_id=nda_action.id,
        matter_id=matter.id,
        document_id=docs["nda"].id,
        submitted_by=jane.id,
        reviewer_id=sarah.id,
        status="returned",
        completed_at=now - timedelta(days=1),
    )
    round2 = ReviewHandoff(
        action_id=spa_action.id,
        matter_id=matter.id,
        document_id=docs["spa"].id,
        submitted_by=jane.id,
        reviewer_id=sarah.id,
        status="ready_for_review",
    )
    db.add_all([round1, round2])
    db.flush()
    nda_action.active_handoff_id = round1.id
    spa_action.active_handoff_id = round2.id
    for quote, kind, suggested, note, status in NDA_FEEDBACK:
        page_no, rects = nda_pdf.anchor(quote)
        db.add(
            ReviewAnnotation(
                handoff_id=round1.id,
                document_id=docs["nda"].id,
                page_no=page_no,
                kind=kind,
                anchor_quote=quote,
                anchor_rects=rects,
                suggested_text=suggested,
                note=note,
                status=status,
                author_user_id=sarah.id,
            )
        )
    db.commit()
    for action in (nda_action, spa_action):
        sync_metadata_safe(db, sync_action_metadata, action)
    for handoff in (round1, round2):
        sync_metadata_safe(db, sync_handoff_metadata, handoff)
    summary.update(tickets=len(TICKETS), review_rounds=2, annotations=len(NDA_FEEDBACK))

    # Wellbeing --------------------------------------------------------------------------------
    questions = _active_questions(db)
    week0 = current_week_start()
    count = 0
    for key, user in (("jane", jane), ("sarah", sarah), ("marcus", marcus)):
        for week_idx in range(6):
            week_of = week0 - timedelta(weeks=5 - week_idx)
            for question in questions:
                pattern = SURVEY_PATTERNS[key][
                    "support" if question.reverse_scored else "pressure"
                ]
                db.add(
                    SurveyResponse(
                        user_id=user.id,
                        question_id=question.id,
                        score=pattern[week_idx],
                        week_of=week_of,
                    )
                )
                count += 1
    db.commit()
    summary["survey_responses"] = count

    # Memories, chat thread, wiki --------------------------------------------------------------
    for category, content in JANE_MEMORIES:
        db.add(Memory(user_id=jane.id, category=category, content=content, scope="personal"))
    thread = ChatThread(user_id=jane.id, title="NDA indemnity question", matter_id=matter.id)
    db.add(thread)
    db.flush()
    db.add(
        ChatMessage(
            thread_id=thread.id,
            role="user",
            content="What are the key risks in the Meridian NDA?",
        )
    )
    db.add(
        ChatMessage(
            thread_id=thread.id,
            role="assistant",
            content="The main risks are the uncapped indemnity in clause 4 and the New York governing law in clause 6.",
        )
    )
    db.commit()
    summary["memories"] = len(JANE_MEMORIES)

    pages: dict[str, WikiPage] = {}
    for title, page_type, body in WIKI_PAGES:
        pages[title] = wiki_service.create_wiki_page(
            db,
            user_id=jane.id,
            schema=WikiPageCreate(
                title=title,
                body_markdown=body,
                page_type=page_type,
                status="published",
                matter_id=matter.id,
            ),
        )
    overview, parties, risks = (pages[t] for t, _, _ in WIKI_PAGES)
    for source, target, text in (
        (overview, parties, "Parties and roles"),
        (overview, risks, "Key risks"),
        (risks, parties, "Who is affected"),
    ):
        db.add(
            WikiLink(
                source_page_id=source.id,
                target_page_id=target.id,
                link_text=text,
                link_type="related",
            )
        )
    db.commit()
    summary["wiki_pages"] = len(WIKI_PAGES)

    processing = db.scalar(
        select(Document.id)
        .where(Document.user_id == jane.id, Document.status == "processing")
        .limit(1)
    )
    summary["documents_still_processing"] = processing is not None
    return summary


def _active_questions(db: Session) -> list[SurveyQuestion]:
    questions = list(
        db.scalars(select(SurveyQuestion).where(SurveyQuestion.is_active.is_(True)))
    )
    if not questions:
        seed_survey_questions(db)
        questions = list(
            db.scalars(select(SurveyQuestion).where(SurveyQuestion.is_active.is_(True)))
        )
    return questions
