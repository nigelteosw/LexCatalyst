"""Add synthetic Singapore property work without resetting other demo content.

Task descriptions are fictional workflow prompts, not legal advice. No LLM calls or real client
data are involved. The Bishan review note PDFs go through the normal upload pipeline (R2 + worker
+ OpenAI embeddings), so a synthetic document is uploaded and embedded.
"""
import asyncio
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    ActionItem,
    KnowledgeBankEntry,
    ChatMessage,
    ChatThread,
    Document,
    Matter,
    MatterMember,
    ReviewAnnotation,
    ReviewHandoff,
    ReviewLesson,
    Team,
    TeamMember,
    User,
)
from app.schemas import KnowledgeBankEntryCreate
from app.services import document_service, knowledge_bank_service
from app.services.demo_pdfs import DemoPdf
from app.services.resource_metadata_service import (
    sync_action_metadata,
    sync_handoff_metadata,
    sync_document_metadata,
    sync_metadata_safe,
)
from app.services.user_service import create_dummy_users

_log = logging.getLogger(__name__)

DEMO_TAG = "property-workboard-demo"
MATTERS = [
    ("DEMO-SG-PROP-001", "[Demo] Tan family — Bishan condominium purchase"),
    ("DEMO-SG-PROP-002", "[Demo] Lim family — Tampines HDB resale"),
    ("DEMO-SG-PROP-003", "[Demo] Harbour Retail — Tanjong Pagar shop lease"),
    ("DEMO-SG-PROP-004", "[Demo] Orchard Court — strata property dispute"),
]
# matter index, title, fictional instructions, stage, priority, relative due day, assignee
TICKETS = [
    (0, "Review option to purchase for Bishan condominium", "Check the fictional OTP, property particulars and proposed completion timetable. Flag points for the supervising lawyer.", "review", "high", -1, "jane"),
    (0, "Prepare title-search and encumbrance summary", "Summarise the synthetic title search and list follow-up enquiries for the seller's solicitors.", "in_progress", "medium", 2, "marcus"),
    (0, "Review sale and purchase agreement amendments", "Review the draft completion provisions and vacant-possession wording before sending to the seller's solicitors.", "review", "high", 1, "sarah"),
    (0, "Confirm completion funds with purchaser", "Await the fictional purchaser's confirmation of funds and lender coordination. Update the completion checklist.", "with_client", "medium", 5, "jane"),
    (1, "Prepare HDB resale document checklist", "Compile documents and questions for the fictional resale parties. Verify current requirements before giving any advice.", "pending", "medium", 3, "marcus"),
    (1, "Draft CPF and stamp-duty client questions", "Draft a fact-gathering email about CPF usage, ownership history and stamp-duty assessment. Do not assume eligibility or rates.", "in_progress", "high", -1, "jane"),
    (1, "Obtain seller confirmation on vacant possession", "Await the seller's solicitors' response on the proposed handover date and removal of belongings.", "with_client", "medium", 4, "sarah"),
    (1, "Complete resale file-opening checks", "Synthetic identity and conflict checks completed. Save the fictional file-opening checklist.", "done", "low", -3, "jane"),
    (2, "Draft commercial lease repair and reinstatement clauses", "Prepare a first draft for the fictional shop lease, identifying responsibility for repairs and end-of-term reinstatement.", "in_progress", "medium", 3, "marcus"),
    (2, "Review landlord comments on rent-free period", "Review the fictional landlord's proposed changes to the fit-out period and deposit terms before client approval.", "review", "high", 0, "sarah"),
    (3, "Prepare strata dispute chronology", "Build a chronology from synthetic correspondence about water leakage and requests to the management corporation.", "pending", "medium", 6, "marcus"),
    (3, "Send approved property dispute update", "The supervising lawyer approved the fictional client update and next-step questions; task complete.", "done", "low", -2, "sarah"),
]


# Pre-written fictional exchanges: no provider calls or fabricated source citations.
CHATS = [
    (
        "[Demo] Bishan purchase — completion planning",
        "For our fictional Bishan condominium purchase, what should I ask the purchaser before preparing the completion checklist?",
        "**Synthetic demo conversation — no documents have been reviewed.**\n\nStart with a fact-gathering checklist:\n\n- Confirm the property particulars and the purchaser's instructions.\n- Obtain the option and draft sale and purchase agreement.\n- Ask about financing, CPF usage and the proposed completion date.\n- Identify open title enquiries and vacant-possession questions.\n\nAsk the supervising lawyer to verify current requirements and the actual documents before advising the client.",
    ),
    (
        "[Demo] Tampines resale — client information checklist",
        "Draft questions for the fictional Lim family about their Tampines HDB resale, without assuming eligibility or stamp-duty rates.",
        "**Synthetic demo conversation.**\n\nA draft client email could ask:\n\n1. Who are the proposed buyers and current owners?\n2. What documents and correspondence have they received for this resale?\n3. Do they own other property or have an existing housing loan?\n4. Will they use CPF savings, and what financing arrangements are proposed?\n5. What handover and move-in dates are they working towards?\n\nKeep eligibility, CPF and tax conclusions open until the facts and current official requirements have been checked.",
    ),
    (
        "[Demo] Shop lease — issues for internal review",
        "Help organise an internal review agenda for the fictional Harbour Retail shop lease in Tanjong Pagar.",
        "**Synthetic demo conversation — illustrative agenda only.**\n\nGroup the open points into:\n\n- **Commercial terms:** rent, deposit, fit-out period and renewal discussions.\n- **Use and alterations:** the intended business, proposed works and consents to investigate.\n- **Repairs:** responsibility for defects, maintenance and access.\n- **Exit:** reinstatement wording, handover arrangements and unresolved landlord comments.\n\nRecord the client's instructions and send the draft issues list to the supervising lawyer before responding to the landlord.",
    ),
    (
        "[Demo] Strata dispute — chronology and evidence",
        "What should go into the chronology for the fictional Orchard Court water-leakage dispute?",
        "**Synthetic demo conversation.**\n\nCreate a table with date, event, source and follow-up. Include the first reported leak, photographs, inspection appointments, correspondence with the management corporation and responses from other parties.\n\nSeparate observed facts from allegations. List missing inspection reports and unanswered questions about the source of the leak. Do not assign liability until the supervising lawyer has reviewed the evidence and applicable requirements.",
    ),
]


# --- Bishan end-to-end case: Jane's OTP review note, reviewed by Sarah ------------------------
OTP_TICKET = "Review option to purchase for Bishan condominium"
STYLE_GUIDE_TITLE = "Firm style guide: Singapore conveyancing correspondence"
STYLE_GUIDE_BODY = """## Dates and deadlines

- State every deadline as a date and time: "by 4pm on 20 October 2026", never "within 14 days".
- Write dates as 20 October 2026. Use the 12-hour clock without full stops: 4pm, 10.30am.

## Obligations and undertakings

- Use "shall" for obligations and "may" for rights. "Will" is for statements of fact or intention only.
- Use the contractual standard: "deliver vacant possession", not "hand over in good condition".

## Stamp duty and figures

- Never state a BSD or ABSD rate or amount until the purchasers' citizenship and existing property holdings are confirmed and the current IRAS rates are checked. Say "ABSD may apply" until then.
- Write percentages as "per cent" in letters ("20 per cent").

## Letters

- "Dear Sirs" closes with "Yours faithfully"; a named addressee closes with "Yours sincerely".
- Refer to the property by its full unit number and development name.
- Associates send nothing to clients or other solicitors before the supervising lawyer has reviewed it.
"""
_NOTE_INTRO = [
    ("title", "Bishan Condominium Purchase: Option to Purchase Review Note"),
    ("para", "Prepared by Jane Pereira for Sarah Chen. Synthetic demo document; all parties and the property are fictional."),
    ("heading", "1. Property"),
    ("para", "Unit #08-12, Bishan Park Residences (fictional), 99-year leasehold. Purchasers: Mr and Mrs Tan."),
]
NOTE_V1_BLOCKS = [
    *_NOTE_INTRO,
    ("heading", "2. Option terms"),
    ("para", "The option fee has been paid and the option must be exercised within 14 days."),
    ("heading", "3. Stamp duty"),
    ("para", "The purchasers already own an HDB flat, so ABSD will be payable at 20% on this purchase."),
    ("heading", "4. Vacant possession"),
    ("para", "The seller will hand over the unit in good condition on completion."),
    ("heading", "5. Next steps"),
    ("para", "We will send the client our advice once the seller's solicitors reply."),
]
NOTE_V2_BLOCKS = [
    *_NOTE_INTRO,
    ("heading", "2. Option terms"),
    ("para", "The option must be exercised by 4pm on 20 October 2026. The option fee is held by the seller's solicitors as stakeholders."),
    ("heading", "3. Stamp duty"),
    ("para", "ABSD may apply. Before advising, we will confirm the purchasers' citizenship and existing property holdings, and check the current IRAS rates."),
    ("heading", "4. Vacant possession"),
    ("para", "The seller is to deliver vacant possession on completion, with the unit free of occupants and the seller's belongings."),
    ("heading", "5. Title"),
    ("para", "The title is clean and there are no encumbrances."),
    ("heading", "6. Next steps"),
    ("para", "I will flag open points to Sarah for review before anything is sent to the client."),
]
# Sarah's round 1 comments: (quote, suggested wording, note)
NOTE_V1_FEEDBACK = [
    (
        "the option must be exercised within 14 days",
        "the option must be exercised by 4pm on 20 October 2026",
        "Give the exact deadline and time. A period on its own invites argument about when it starts.",
    ),
    (
        "ABSD will be payable at 20% on this purchase",
        "ABSD may apply. Before advising, we will confirm the purchasers' citizenship and existing property holdings, and check the current IRAS rates",
        "Never state a stamp-duty rate or eligibility from an assumption. Confirm the facts and the current rates first.",
    ),
    (
        "hand over the unit in good condition",
        "deliver vacant possession",
        "'Good condition' is not the contractual standard. Use vacant possession and say what it covers.",
    ),
    (
        "We will send the client our advice once the seller's solicitors reply.",
        "I will flag open points to Sarah for review before anything is sent to the client.",
        "Nothing goes to the client before the supervising lawyer has reviewed it.",
    ),
]
# Pre-written lessons so Birdie can mentor without an LLM call at seed time: (title, body, source indexes)
NOTE_V1_LESSONS = [
    ("Give exact deadlines, not periods", "Write the date and time an option or notice expires. A bare period leaves room to argue about when it started.", [0]),
    ("Never assume stamp-duty rates or eligibility", "Confirm citizenship and existing property holdings, and check the current IRAS rates, before saying ABSD applies or at what rate.", [1]),
    ("Use the contractual standard: vacant possession", "Say 'vacant possession' and spell out what it covers instead of informal words like 'good condition'.", [2]),
    ("Supervisor review before the client", "Flag open points to your supervising lawyer first. Nothing goes to the client until they have reviewed it.", [3]),
]


async def _ensure_demo_document(
    db: Session, *, owner: User, matter: Matter, team: Team, filename: str, pdf: DemoPdf
) -> Document:
    """Create (or recover) one synthetic demo PDF on a matter; embedding runs through the normal worker."""
    document = db.scalar(select(Document).where(
        Document.matter_id == matter.id, Document.filename == filename,
        Document.user_id == owner.id,
    ))
    if document is None:
        document = await document_service.create_pending_document(
            db, user_id=owner.id, filename=filename, content_type="application/pdf",
            file_bytes=pdf.bytes, matter_id=matter.id, team_id=team.id,
        )
    elif document.status == "failed" or (document.status == "uploaded" and not document.storage_key):
        try:
            if not document.storage_key:
                document.storage_key = await asyncio.to_thread(
                    document_service.upload_document_file,
                    file_bytes=pdf.bytes, user_id=owner.id, document_id=document.id,
                    filename=filename, content_type="application/pdf",
                )
            document.status = "processing"
            document.error_message = None
            document.processing_attempts = 0
            document.processing_started_at = None
            document.updated_at = datetime.now(UTC)
            db.commit()
            sync_metadata_safe(db, sync_document_metadata, document)
        except (document_service.StorageError, ValueError) as exc:
            db.rollback()
            document.status = "failed"
            document.error_message = str(exc)[:document_service.MAX_ERROR_LENGTH]
            db.commit()
            sync_metadata_safe(db, sync_document_metadata, document)
    if document.status == "failed":
        _log.warning("Property demo document %s failed: %s", filename, document.error_message)
    return document


async def _seed_bishan_review(db: Session, *, matter: Matter, team: Team, users: dict[str, User]) -> dict:
    """Two review rounds on Jane's OTP note: v1 returned with Sarah's comments and lessons, v2 waiting."""
    jane, sarah = users["jane"], users["sarah"]
    ticket = db.scalar(select(ActionItem).where(ActionItem.matter_id == matter.id, ActionItem.title == OTP_TICKET))
    filenames = ("Bishan OTP review note v1.pdf", "Bishan OTP review note v2.pdf")
    if ticket is None:
        return {"review_rounds_created": 0}

    v1_pdf, v2_pdf = DemoPdf(NOTE_V1_BLOCKS), DemoPdf(NOTE_V2_BLOCKS)
    docs = [
        await _ensure_demo_document(db, owner=jane, matter=matter, team=team, filename=filename, pdf=pdf)
        for filename, pdf in zip(filenames, (v1_pdf, v2_pdf))
    ]

    document_summary = {
        "documents_failed": sum(d.status == "failed" for d in docs),
        "documents_processing": sum(d.status in ("uploaded", "processing") for d in docs),
    }
    existing_rounds = list(db.scalars(select(ReviewHandoff).where(
        ReviewHandoff.action_id == ticket.id, ReviewHandoff.document_id.in_([d.id for d in docs]),
    )))
    if existing_rounds:
        return {"review_rounds_created": 0, **document_summary}

    now = datetime.now(UTC)
    round1 = ReviewHandoff(
        action_id=ticket.id, matter_id=matter.id, document_id=docs[0].id, submitted_by=jane.id,
        reviewer_id=sarah.id, status="returned", completed_at=now - timedelta(days=1),
        submitted_at=now - timedelta(days=2),
    )
    round2 = ReviewHandoff(
        action_id=ticket.id, matter_id=matter.id, document_id=docs[1].id, submitted_by=jane.id,
        reviewer_id=sarah.id, status="ready_for_review",
    )
    db.add_all([round1, round2])
    db.flush()
    ticket.active_handoff_id = round2.id
    ticket.status = "review"
    annotations = []
    for quote, suggested, note in NOTE_V1_FEEDBACK:
        page_no, rects = v1_pdf.anchor(quote)
        annotation = ReviewAnnotation(
            handoff_id=round1.id, document_id=docs[0].id, page_no=page_no, kind="suggestion",
            anchor_quote=quote, anchor_rects=rects, suggested_text=suggested, note=note,
            status="open", author_user_id=sarah.id,
        )
        db.add(annotation)
        annotations.append(annotation)
    db.flush()
    for title, body, sources in NOTE_V1_LESSONS:
        db.add(ReviewLesson(
            handoff_id=round1.id, title=title, body=body,
            source_annotation_ids=[annotations[i].id for i in sources],
        ))
    db.commit()
    sync_metadata_safe(db, sync_action_metadata, ticket)
    for handoff in (round1, round2):
        sync_metadata_safe(db, sync_handoff_metadata, handoff)
    return {"review_rounds_created": 2, **document_summary}


# --- Tampines HDB resale (DEMO-SG-PROP-002): synthetic documents behind the matter's tickets ---
# No eligibility, CPF or stamp-duty conclusions: those stay open until facts and current rules are checked.
TAMPINES_DOCUMENTS = [
    ("Tampines HDB resale: option to purchase (extract).pdf", [
        ("title", "Option to Purchase (Extract): HDB Resale Flat"),
        ("para", "Between Mr and Mrs Lim (the Sellers) and Mr Goh (the Buyer). Synthetic demo document; all parties and the flat are fictional."),
        ("heading", "1. Flat"),
        ("para", "Block 123, Tampines Street 11, Unit #09-456 (fictional), a four-room HDB flat on a 99-year lease."),
        ("heading", "2. Option fee and exercise"),
        ("para", "The Buyer has paid an option fee of S$1,000. The option may be exercised by 4pm on 27 October 2026 by written notice to the Sellers' solicitors."),
        ("heading", "3. Purchase price and financing"),
        ("para", "The purchase price is S$560,000. The Buyer's CPF usage and any housing loan are to be confirmed in writing before the resale application is submitted."),
        ("heading", "4. Vacant possession"),
        ("para", "The Sellers shall deliver vacant possession on completion, with the flat free of occupants and the Sellers' belongings."),
    ]),
    ("Tampines resale: client information checklist.pdf", [
        ("title", "Client Information Checklist: Tampines HDB Resale"),
        ("para", "Prepared for the Lim family file. Synthetic demo document. Open items are listed as questions; no eligibility or stamp-duty conclusion is drawn."),
        ("heading", "1. Parties and ownership history"),
        ("para", "Confirm the full names, citizenship and identity documents of each Seller and the Buyer, and when the Sellers acquired the flat."),
        ("heading", "2. Financing"),
        ("para", "Ask whether the Buyer will use CPF savings or a housing loan, and obtain the in-principle approval if a loan is proposed."),
        ("heading", "3. Stamp duty"),
        ("para", "Ask whether the Buyer owns any other property. Check the current IRAS rates before stating any amount to the client."),
        ("heading", "4. Documents to collect"),
        ("para", "Option to purchase, HDB resale application reference, the Sellers' outstanding loan statement and the latest valuation, if any."),
    ]),
    ("Tampines resale: seller's solicitors on vacant possession.pdf", [
        ("title", "Correspondence Extract: Vacant Possession"),
        ("para", "From the Sellers' solicitors to our firm. Synthetic demo document."),
        ("heading", "Handover"),
        ("para", "Our clients propose to hand over the flat on 30 November 2026, once their move to the new home is complete."),
        ("para", "Our clients will remove their belongings before completion but ask that minor fittings, including the curtain rails, stay in the flat."),
        ("heading", "Outstanding"),
        ("para", "Please confirm whether your client accepts the proposed handover date and the fittings that will remain."),
    ]),
]


async def _seed_tampines_documents(db: Session, *, matter: Matter, team: Team, users: dict[str, User]) -> dict:
    owner = users["jane"]
    docs = [
        await _ensure_demo_document(db, owner=owner, matter=matter, team=team, filename=name, pdf=DemoPdf(blocks))
        for name, blocks in TAMPINES_DOCUMENTS
    ]
    return {
        "tampines_documents": len(docs),
        "tampines_documents_failed": sum(d.status == "failed" for d in docs),
    }


async def _seed_style_guide(db: Session, *, presenter: User) -> bool:
    """Firm-wide conveyancing style guide that Birdie's draft review cites. Created once."""
    if db.scalar(select(KnowledgeBankEntry.id).where(KnowledgeBankEntry.title == STYLE_GUIDE_TITLE)):
        return False
    try:
        await knowledge_bank_service.create_kb_entry(
            db,
            user=presenter,
            schema=KnowledgeBankEntryCreate(
                scope="firm_wide", entry_type="style_guide", title=STYLE_GUIDE_TITLE,
                body_markdown=STYLE_GUIDE_BODY,
                tags=["style", "conveyancing", "Singapore property", DEMO_TAG],
            ),
        )
        return True
    except Exception as exc:  # embedding / provider failures should not abort the seed
        db.rollback()
        _log.warning("Property style guide failed: %s", exc)
        return False


async def seed_property_workboard(db: Session, *, presenter: User) -> dict:
    users = {u.google_id.split(":", 1)[1].split("-")[0]: u for u in create_dummy_users(db)}
    participants = [presenter, *users.values()]
    team = db.scalar(select(Team).where(Team.name == "Singapore Property (Demo)"))
    if team is None:
        team = Team(name="Singapore Property (Demo)", practice_area="Singapore property law")
        db.add(team)
        db.flush()
    for user in participants:
        if db.scalar(select(TeamMember).where(TeamMember.team_id == team.id, TeamMember.user_id == user.id)) is None:
            db.add(TeamMember(team_id=team.id, user_id=user.id, role=user.firm_role))
    matters = []
    for case_number, title in MATTERS:
        matter = db.scalar(select(Matter).where(Matter.case_number == case_number))
        if matter is None:
            matter = Matter(team_id=team.id, case_number=case_number, title=title)
            db.add(matter)
            db.flush()
        for user in participants:
            if db.scalar(select(MatterMember).where(MatterMember.matter_id == matter.id, MatterMember.user_id == user.id)) is None:
                db.add(MatterMember(matter_id=matter.id, user_id=user.id, role=user.firm_role, granted_by=presenter.id))
        matters.append(matter)
    existing = {
        (item.matter_id, item.title)
        for item in db.scalars(select(ActionItem).where(ActionItem.matter_id.in_([m.id for m in matters])))
        if DEMO_TAG in (item.tags or [])
    }
    created = []
    now = datetime.now(UTC)
    for index, title, description, status, priority, offset, assignee in TICKETS:
        matter = matters[index]
        if (matter.id, title) in existing:
            continue
        item = ActionItem(title=title, description="Synthetic demo task. " + description,
                          matter_id=matter.id, assigner_id=users["sarah"].id,
                          assignee_id=users[assignee].id, status=status, priority=priority,
                          due_date=now + timedelta(days=offset), tags=[DEMO_TAG, "Singapore property"])
        db.add(item)
        created.append(item)
    chats_created = 0
    for user in participants:
        for index, (title, question, response) in enumerate(CHATS):
            matter = matters[index]
            existing_thread = db.scalar(select(ChatThread).where(
                ChatThread.user_id == user.id, ChatThread.matter_id == matter.id,
                ChatThread.title == title,
            ))
            if existing_thread is not None:
                continue
            thread = ChatThread(user_id=user.id, matter_id=matter.id, title=title)
            db.add(thread)
            db.flush()
            db.add_all([
                ChatMessage(thread_id=thread.id, role="user", content=question,
                            created_at=now - timedelta(minutes=2)),
                ChatMessage(thread_id=thread.id, role="assistant", content=response,
                            created_at=now - timedelta(minutes=1)),
            ])
            chats_created += 1
    db.commit()
    for item in created:
        sync_metadata_safe(db, sync_action_metadata, item)
    # The demo opens on the overdue Bishan OTP review, so keep it overdue on every reload.
    otp = db.scalar(select(ActionItem).where(ActionItem.matter_id == matters[0].id, ActionItem.title == OTP_TICKET))
    if otp is not None and otp.status != "done":
        otp.due_date = now - timedelta(days=1)
        db.commit()
    review = await _seed_bishan_review(db, matter=matters[0], team=team, users=users)
    tampines = await _seed_tampines_documents(db, matter=matters[1], team=team, users=users)
    style_guide = await _seed_style_guide(db, presenter=presenter)
    return {
        "style_guide_created": style_guide,
        "tickets_created": len(created),
        "matters": len(matters),
        "chats_created": chats_created,
        **review,
        **tampines,
    }
