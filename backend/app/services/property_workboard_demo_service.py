"""Add synthetic Singapore property work without resetting other demo content.

Task descriptions are fictional workflow prompts, not legal advice. No document text,
LLM calls, external services or real client data are involved in this seed.
"""
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ActionItem, ChatMessage, ChatThread, Matter, MatterMember, Team, TeamMember, User
from app.services.resource_metadata_service import sync_action_metadata, sync_metadata_safe
from app.services.user_service import create_dummy_users

DEMO_TAG = "property-workboard-demo"
MATTERS = [
    ("DEMO-SG-PROP-001", "[Demo] Tan family — Bishan condominium purchase"),
    ("DEMO-SG-PROP-002", "[Demo] Lim family — Tampines HDB resale"),
    ("DEMO-SG-PROP-003", "[Demo] Harbour Retail — Tanjong Pagar shop lease"),
    ("DEMO-SG-PROP-004", "[Demo] Orchard Court — strata property dispute"),
]
# matter index, title, fictional instructions, stage, priority, relative due day, assignee
TICKETS = [
    (0, "Review option to purchase for Bishan condominium", "Check the fictional OTP, property particulars and proposed completion timetable. Flag points for the supervising lawyer.", "pending", "high", 0, "jane"),
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


def seed_property_workboard(db: Session, *, presenter: User) -> dict:
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
    return {"tickets_created": len(created), "matters": len(matters), "chats_created": chats_created}
