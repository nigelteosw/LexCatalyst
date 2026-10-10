"""Tables that carry class_id and the same-class keys linking them.

The composite keys in migration b5c6d7e8f9a0 and the ORM mirror in app/models.py both come from
here, and the class migration service and its tests read the same list.
"""

PARENT_TABLES = (
    "teams",
    "matters",
    "documents",
    "document_folders",
    "chat_threads",
    "kb_entries",
    "action_items",
    "review_handoffs",
)

# Child table, child reference, parent table. Parent classes must match after
# the whole reviewed mapping is applied, including when the parent stays quarantined.
CLASS_LINKS = (
    ("matters", "team_id", "teams"),
    ("documents", "matter_id", "matters"),
    ("documents", "team_id", "teams"),
    ("documents", "folder_id", "document_folders"),
    ("document_folders", "matter_id", "matters"),
    ("chat_threads", "matter_id", "matters"),
    ("memories", "source_thread_id", "chat_threads"),
    ("kb_entries", "team_id", "teams"),
    ("kb_entries", "matter_id", "matters"),
    ("kb_entries", "source_entry_id", "kb_entries"),
    ("kb_entries", "source_document_id", "documents"),
    ("resource_metadata", "team_id", "teams"),
    ("resource_metadata", "matter_id", "matters"),
    ("resource_metadata", "source_document_id", "documents"),
    ("action_items", "matter_id", "matters"),
    ("review_handoffs", "action_id", "action_items"),
    ("review_handoffs", "matter_id", "matters"),
    ("review_handoffs", "document_id", "documents"),
    ("review_lessons", "handoff_id", "review_handoffs"),
    ("birdie_reviews", "matter_id", "matters"),
)
