import json
from collections.abc import AsyncGenerator

from sqlalchemy.orm import Session

from app.dependencies import check_kb_read
from app.models import User
from app.services.llm_service import get_llm
from app.services.document_service import get_document_full_text
from app.services.knowledge_bank_service import (
    get_kb_entry,
    search_kb_for_chat,
)
from app.services.memory_service import list_memories
from app.services.rag_service import search_documents

MAX_TOOL_ROUNDS = 4
MAX_MEMORY_RESULTS = 6
MAX_KB_BODY_PREVIEW = 2000

# --- Tool execution -------------------------------------------------------


async def _execute_tool(
    name: str,
    args: dict,
    *,
    db: Session,
    user: User,
    matter_id: str | None,
) -> tuple[str, str]:
    """Return (result_text_for_llm, short_summary_for_ui)."""
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
        parts = [
            f"Source {i} — {r.citation_label}\n{r.text}"
            for i, r in enumerate(results, start=1)
        ]
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
        body = "\n\n---\n\n".join(
            f"[KB:{e.id}] {e.title} ({e.entry_type}, {e.scope})\n"
            f"{e.body_markdown[:MAX_KB_BODY_PREVIEW]}"
            for e in entries
        )
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
        header = f"# {entry.title}\nType: {entry.entry_type} | Scope: {entry.scope}"
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
        body = f"# {document.filename}\n\n{full_text}"
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

            result_text, summary = await _execute_tool(
                name, args, db=db, user=user, matter_id=matter_id,
            )

            yield (
                "tool_result",
                {"step_id": step_id, "tool": name, "summary": summary},
            )

            current_messages.append({
                "role": "tool",
                "tool_call_id": step_id,
                "content": result_text,
            })

    # Loop should have returned via the no-tool-calls branch; if we fall
    # through, persist any pending audit log commits to be safe.
    db.commit()
