import json
from collections.abc import AsyncGenerator

from sqlalchemy.orm import Session

from app.dependencies import check_kb_read
from app.models import Document, User
from app.services.llm_service import get_llm
from app.services.document_service import get_document_full_text
from app.services.knowledge_bank_service import (
    get_kb_entry,
    search_kb_for_chat,
)
from app.services.memory_service import list_memories
from app.services.rag_service import search_documents

class SourceRegistry:
    """Numbers the sources a turn consults so the answer can cite them as [n] footnotes."""

    def __init__(self) -> None:
        self.sources: list[dict] = []
        self._index: dict[tuple, int] = {}

    def add(
        self,
        *,
        kind: str,
        id: str,
        title: str,
        locator: str | None = None,
        matter_id: str | None = None,
    ) -> int:
        key = (kind, id, locator)
        if key in self._index:
            return self._index[key]
        number = len(self.sources) + 1
        self.sources.append(
            {
                "n": number,
                "kind": kind,
                "id": id,
                "title": title,
                "locator": locator,
                "matter_id": matter_id,
            }
        )
        self._index[key] = number
        return number


MAX_TOOL_ROUNDS = 4
MAX_MEMORY_RESULTS = 6
MAX_KB_BODY_PREVIEW = 2000

TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "search_documents",
            "description": (
                "Search uploaded legal documents for relevant clauses, facts, or analysis. "
                "Use when the question requires specific text from uploaded files."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Natural-language search query"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_knowledge_bank",
            "description": (
                "Search the firm's knowledge bank for playbooks, precedents, style guides, "
                "and soft-skill advice the user has access to."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Natural-language search query"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_memories",
            "description": (
                "Keyword-search the user's memory bank for personal context, working style "
                "preferences, and past matter facts."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Keyword(s) to match against memories"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_kb_entry",
            "description": (
                "Fetch the full content of a specific knowledge bank entry by its ID. "
                "Use after search_knowledge_bank when you want to read an entry in full."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "entry_id": {"type": "string", "description": "The knowledge bank entry ID"},
                },
                "required": ["entry_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_document",
            "description": (
                "Read the full extracted text of an uploaded document by its ID. "
                "Use this when the KB summary is not detailed enough and you need to "
                "quote or analyse the original document. The document_id can be found "
                "on a KB entry as 'source_document_id', or surfaced by search_documents."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "document_id": {"type": "string", "description": "The document ID"},
                },
                "required": ["document_id"],
            },
        },
    },
]

# --- Tool execution -------------------------------------------------------


async def _execute_tool(
    name: str,
    args: dict,
    *,
    db: Session,
    user: User,
    matter_id: str | None,
    registry: SourceRegistry,
) -> tuple[str, str]:
    """Return (result_text_for_llm, short_summary_for_ui). Sources are numbered via `registry`."""
    if name == "search_documents":
        query = str(args.get("query", "")).strip()
        if not query:
            return "No query provided.", "no query"
        try:
            results = await search_documents(
                db, query=query, user_id=user.id, matter_id=matter_id,
            )
        except Exception as exc:
            return f"Document search unavailable: {exc}", "search unavailable"
        if not results:
            return "No relevant document chunks found.", "no results"
        parts = []
        for r in results:
            owner = db.get(Document, r.document_id)
            number = registry.add(
                kind="document",
                id=r.document_id,
                title=r.filename,
                locator=f"p. {r.page_number}" if r.page_number else None,
                matter_id=owner.matter_id if owner else None,
            )
            parts.append(f"[{number}] {r.citation_label}\n{r.text}")
        summary = f"{len(results)} chunk{'s' if len(results) != 1 else ''}"
        return "\n\n---\n\n".join(parts), summary

    if name == "search_knowledge_bank":
        query = str(args.get("query", "")).strip()
        if not query:
            return "No query provided.", "no query"
        try:
            entries = await search_kb_for_chat(
                db, user_id=user.id, query=query, matter_id=matter_id,
            )
        except Exception as exc:
            return f"Knowledge bank search unavailable: {exc}", "search unavailable"
        if not entries:
            return "No relevant knowledge bank entries found.", "no results"
        blocks = []
        for e in entries:
            number = registry.add(
                kind="kb_entry",
                id=e.id,
                title=e.title,
                locator=e.entry_type.replace("_", " "),
                matter_id=e.matter_id,
            )
            blocks.append(
                f"[{number}] {e.title} ({e.entry_type}, {e.scope}, entry_id: {e.id})\n"
                f"{e.body_markdown[:MAX_KB_BODY_PREVIEW]}"
            )
        body = "\n\n---\n\n".join(blocks)
        summary = f"{len(entries)} KB entr{'ies' if len(entries) != 1 else 'y'}"
        return body, summary

    if name == "search_memories":
        query = str(args.get("query", "")).strip()
        relevant = list_memories(
            db,
            user_id=user.id,
            contains=query or None,
            limit=MAX_MEMORY_RESULTS,
        )
        if not relevant:
            return "No relevant memories found.", "no results"
        body = "\n".join(f"[{m.category}] {m.content}" for m in relevant)
        summary = f"{len(relevant)} memor{'ies' if len(relevant) != 1 else 'y'}"
        return body, summary

    if name == "get_kb_entry":
        entry_id = str(args.get("entry_id", "")).strip()
        if not entry_id:
            return "No entry ID provided.", "no id"
        entry = get_kb_entry(db, entry_id)
        if not entry:
            return f"Knowledge bank entry '{entry_id}' not found.", "not found"
        if not check_kb_read(db, user, entry):
            return (
                f"You do not have access to entry '{entry_id}'.",
                "access denied",
            )
        number = registry.add(
            kind="kb_entry",
            id=entry.id,
            title=entry.title,
            locator=entry.entry_type.replace("_", " "),
            matter_id=entry.matter_id,
        )
        header = f"[{number}] # {entry.title}\nType: {entry.entry_type} | Scope: {entry.scope}"
        if entry.source_document_id:
            header += f" | source_document_id: {entry.source_document_id}"
        body = f"{header}\n\n{entry.body_markdown}"
        summary = f"loaded: {entry.title[:60]}"
        return body, summary

    if name == "read_document":
        document_id = str(args.get("document_id", "")).strip()
        if not document_id:
            return "No document ID provided.", "no id"
        result = get_document_full_text(
            db, user_id=user.id, document_id=document_id,
        )
        if result is None:
            return f"Document '{document_id}' not found.", "not found"
        document, full_text = result
        if not full_text:
            return (
                f"Document '{document.filename}' has no extracted text yet.",
                "no text",
            )
        summary = (
            f"read: {document.filename} ({len(full_text):,} chars)"
        )
        number = registry.add(
            kind="document",
            id=document.id,
            title=document.filename,
            matter_id=document.matter_id,
        )
        body = f"[{number}] # {document.filename}\n\n{full_text}"
        return body, summary

    return f"Unknown tool: {name}", "unknown tool"


# --- ReAct loop -----------------------------------------------------------


AgentEvent = tuple[str, dict]


def _call_fingerprint(tool_call: dict) -> str:
    """Stable hash of a tool call so we can detect repeats."""
    fn = tool_call.get("function", {})
    return f"{fn.get('name', '')}::{fn.get('arguments', '')}"


async def run_agent_loop(
    messages: list[dict],
    db: Session,
    *,
    user: User,
    matter_id: str | None,
    model: str,
) -> AsyncGenerator[AgentEvent, None]:
    """
    Run a ReAct-style tool-calling loop and yield streaming events.

    Yields:
      ("token",       {"content": str})
      ("tool_call",   {"step_id": str, "tool": str, "args": dict})
      ("tool_result", {"step_id": str, "tool": str, "summary": str})
      ("sources",     {"sources": [{"n", "kind", "id", "title", "locator", "matter_id"}]})

    Loop design:
      - Up to MAX_TOOL_ROUNDS rounds of tool calls are allowed.
      - The (MAX_TOOL_ROUNDS + 1)-th iteration is a final round with tools
        disabled, forcing the model to produce a text answer.
      - If the model issues an identical tool call (same name + args) twice
        in a row, the loop short-circuits to the final answer round to
        prevent runaway loops on hallucinated queries.
    """
    provider = get_llm(db, user.id, feature="lexchat", model=model)
    current_messages = list(messages)
    previous_fingerprints: set[str] = set()
    registry = SourceRegistry()

    for round_num in range(MAX_TOOL_ROUNDS + 1):
        is_final_round = round_num == MAX_TOOL_ROUNDS
        tools = [] if is_final_round else TOOLS

        if is_final_round:
            current_messages.append({
                "role": "system",
                "content": (
                    "You have gathered enough information. Write the complete "
                    "final answer for the user now, using ordinary prose. "
                    "Do NOT attempt any further tool calls and do NOT output "
                    "tool-call syntax. The tools are no longer available."
                ),
            })

        accumulated_tool_calls: list[dict] = []
        assistant_content: str | None = None

        async for event_type, event_data in provider.stream_with_tools(
            current_messages, tools,
        ):
            if event_type == "token":
                yield ("token", {"content": event_data})
            elif event_type == "tool_calls":
                accumulated_tool_calls = event_data["tool_calls"]
                assistant_content = event_data["content"]

        if not accumulated_tool_calls:
            return

        # Detect duplicate tool-call rounds; force final answer if seen.
        round_fingerprints = {_call_fingerprint(tc) for tc in accumulated_tool_calls}
        if round_fingerprints.issubset(previous_fingerprints):
            current_messages.append({
                "role": "system",
                "content": (
                    "You are repeating the same tool calls. Stop and answer "
                    "with what you already have."
                ),
            })
            # Skip executing the repeats; go straight to final-answer round.
            continue
        previous_fingerprints |= round_fingerprints

        # Persist the assistant turn (tool_calls + reasoning) before any tool replies.
        # Ensure every tool_call has a stable id so the tool reply ids match.
        for tool_index, tool_call in enumerate(accumulated_tool_calls):
            if not tool_call.get("id"):
                tool_call["id"] = (
                    f"call_{round_num}_{tool_index}_"
                    f"{tool_call['function']['name']}"
                )

        current_messages.append({
            "role": "assistant",
            "content": assistant_content,
            "tool_calls": accumulated_tool_calls,
        })

        # Execute each tool and feed results back.
        for tool_call in accumulated_tool_calls:
            name = tool_call["function"]["name"]
            step_id = tool_call["id"]
            try:
                args: dict = json.loads(tool_call["function"]["arguments"])
            except (json.JSONDecodeError, ValueError):
                args = {}

            yield ("tool_call", {"step_id": step_id, "tool": name, "args": args})

            known_sources = len(registry.sources)
            result_text, summary = await _execute_tool(
                name, args, db=db, user=user, matter_id=matter_id, registry=registry,
            )

            yield (
                "tool_result",
                {"step_id": step_id, "tool": name, "summary": summary},
            )
            if len(registry.sources) != known_sources:
                yield ("sources", {"sources": list(registry.sources)})

            current_messages.append({
                "role": "tool",
                "tool_call_id": step_id,
                "content": result_text,
            })

    # Loop should have returned via the no-tool-calls branch; if we fall
    # through, persist any pending audit log commits to be safe.
    db.commit()
