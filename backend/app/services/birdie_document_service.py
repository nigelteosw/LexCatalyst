"""Birdie tools for the firm's uploaded documents: find_documents and read_document.

Document text sent here goes to the user's OpenRouter model (the same disclosure
as LexChat). Every lookup is access-checked against the document, and results
never cross matters unless the user asked for that explicitly (all_matters).
"""

from typing import Any

from sqlalchemy.orm import Session

from app.models import Document, User
from app.services.document_catalogue_service import search_document_catalogue
from app.services.document_service import can_access_document, get_document_full_text
from app.services.rag_service import search_documents

FIND_LIMIT = 8
READ_CHAR_LIMIT = 6_000

DOCUMENT_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "find_documents",
            "description": (
                "Find the firm's uploaded documents by their metadata: tags, summary, type, status "
                "and matter. Use when the user refers to their own documents (for example 'the OTP "
                "for Tampines' or 'our NDAs'). Returns document ids to pass to read_document. "
                "Searches the current matter unless all_matters is true."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Natural-language description of the document"},
                    "tags": {"type": "array", "items": {"type": "string"}, "description": "Tags that must all match"},
                    "document_type": {"type": "string", "description": "e.g. NDA, SPA, OTP, Lease, Letter, Other"},
                    "all_matters": {
                        "type": "boolean",
                        "description": "Only true when the user explicitly asks to search beyond the current matter.",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_document",
            "description": (
                "Read the text of one document by id from find_documents. Pass a query to get the "
                "passages most relevant to it; omit it for the start of the document. Read a document "
                "before quoting it, and cite the filename."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "document_id": {"type": "string"},
                    "query": {"type": "string", "description": "What to look for in the document"},
                },
                "required": ["document_id"],
            },
        },
    },
]


async def _find(db: Session, user: User, args: dict, matter_id: str | None) -> dict:
    query = str(args.get("query") or "").strip()[:200] or None
    tags = [t for t in (args.get("tags") or []) if isinstance(t, str)][:10]
    document_type = args.get("document_type")
    if document_type is not None and not isinstance(document_type, str):
        return {"error": "document_type must be a string."}
    all_matters = args.get("all_matters") is True
    rows = await search_document_catalogue(
        db,
        user=user,
        query=query,
        tags=tags,
        document_type=document_type,
        matter_id=None if all_matters else matter_id,
        limit=FIND_LIMIT,
    )
    if not rows:
        return {"results": "No documents matched. Say so; do not guess at documents."}
    return {
        "results": [
            {
                "document_id": row["document_id"],
                "filename": row["filename"],
                "matter": row["matter_name"] or "General",
                "tags": row["tags"],
                "summary": row["summary"],
                "document_type": row["document_type"],
                "document_status": row["document_status"],
                "execution_date": row["execution_date"].isoformat() if row["execution_date"] else None,
            }
            for row in rows
        ]
    }


async def _read(db: Session, user: User, args: dict, limit: int = READ_CHAR_LIMIT) -> dict:
    document_id = args.get("document_id")
    if not isinstance(document_id, str) or not document_id:
        return {"error": "document_id is required."}
    document = db.get(Document, document_id)
    if not document or not can_access_document(db, user_id=user.id, document=document):
        # Same answer for missing and forbidden, so ids cannot be probed.
        return {"error": "Document not found or not accessible."}
    if document.status != "ready":
        return {"error": "Document is still being processed."}

    query = str(args.get("query") or "").strip()[:200]
    if query:
        results = await search_documents(db, query=query, user_id=user.id, document_id=document.id, limit=6)
        if not results:
            return {"results": f"No passages in {document.filename} matched."}
        text = "\n\n".join(f"[{r.citation_label}]\n{r.text}" for r in results)
    else:
        loaded = get_document_full_text(db, user_id=user.id, document_id=document.id, max_chars=limit)
        if not loaded:
            return {"error": "Document has no extracted text."}
        _, text = loaded
    return {"filename": document.filename, "document_id": document.id, "text": text[:limit]}


async def execute_document_tool(
    name: str,
    args: dict,
    *,
    db: Session,
    user: User,
    matter_id: str | None,
    max_read_chars: int | None = None,
) -> dict:
    if name == "find_documents":
        return await _find(db, user, args, matter_id)
    if name == "read_document":
        return await _read(db, user, args, max_read_chars or READ_CHAR_LIMIT)
    return {"error": f"Unknown document tool {name}"}
