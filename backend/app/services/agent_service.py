import json
from collections.abc import AsyncGenerator

from sqlalchemy.orm import Session

from app.providers.deepseek import DeepSeekProvider
from app.services.knowledge_bank_service import get_kb_entry, search_kb_for_chat
from app.services.memory_service import list_memories
from app.services.rag_service import search_documents

MAX_TOOL_ROUNDS = 5

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
                "Search the firm's knowledge bank for precedents, playbooks, partner preferences, "
                "style guides, and matter notes."
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
                "Search the user's memory bank for personal context, working style preferences, "
                "and past matter facts."
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
]


async def _execute_tool(
    name: str,
    args: dict,
    *,
    db: Session,
    user_id: str,
    matter_id: str | None,
) -> str:
    if name == "search_documents":
        query = str(args.get("query", "")).strip()
        if not query:
            return "No query provided."
        try:
            results = await search_documents(db, query=query, user_id=user_id)
        except Exception as exc:
            return f"Document search unavailable: {exc}"
        if not results:
            return "No relevant document chunks found."
        parts = []
        for i, r in enumerate(results, start=1):
            parts.append(f"Source {i} — {r.citation_label}\n{r.text}")
        return "\n\n---\n\n".join(parts)

    if name == "search_knowledge_bank":
        query = str(args.get("query", "")).strip()
        if not query:
            return "No query provided."
        try:
            entries = await search_kb_for_chat(
                db, user_id=user_id, query=query, matter_id=matter_id
            )
        except Exception as exc:
            return f"Knowledge bank search unavailable: {exc}"
        if not entries:
            return "No relevant knowledge bank entries found."
        return "\n\n---\n\n".join(
            f"[KB:{e.id}] {e.title} ({e.entry_type}, {e.scope})\n{e.body_markdown[:2000]}"
            for e in entries
        )

    if name == "search_memories":
        query = str(args.get("query", "")).strip().lower()
        memories = list_memories(db, user_id=user_id)
        relevant = [m for m in memories if not query or query in m.content.lower()][:6]
        if not relevant:
            return "No relevant memories found."
        return "\n".join(f"[{m.category}] {m.content}" for m in relevant)

    if name == "get_kb_entry":
        entry_id = str(args.get("entry_id", "")).strip()
        if not entry_id:
            return "No entry ID provided."
        entry = get_kb_entry(db, entry_id)
        if not entry:
            return f"Knowledge bank entry '{entry_id}' not found."
        return f"# {entry.title}\nType: {entry.entry_type} | Scope: {entry.scope}\n\n{entry.body_markdown}"

    return f"Unknown tool: {name}"


def _tool_result_summary(name: str, result: str) -> str:
    lower = result.lower()
    if "not found" in lower or "no relevant" in lower or "unavailable" in lower:
        return result.rstrip(".")

    if name == "search_documents":
        count = result.count("[")
        return f"{count} chunk{'s' if count != 1 else ''} found"
    if name == "search_knowledge_bank":
        count = result.count("[KB:")
        return f"{count} KB entr{'ies' if count != 1 else 'y'} found"
    if name == "search_memories":
        count = result.count("[")
        return f"{count} memor{'ies' if count != 1 else 'y'} found"
    if name == "get_kb_entry":
        first_line = result.split("\n")[0].lstrip("# ")
        return f"Loaded: {first_line[:80]}"
    return "Done"


AgentEvent = tuple[str, dict]


async def run_agent_loop(
    messages: list[dict],
    db: Session,
    *,
    user_id: str,
    matter_id: str | None,
    model: str,
) -> AsyncGenerator[AgentEvent, None]:
    """
    Async generator that drives the ReAct loop and yields:
      ("tool_call",   {"tool": str, "args": dict})
      ("tool_result", {"tool": str, "summary": str})
      ("token",       {"content": str})
    """
    provider = DeepSeekProvider()
    current_messages = list(messages)

    for round_num in range(MAX_TOOL_ROUNDS + 1):
        is_final_round = round_num == MAX_TOOL_ROUNDS
        tools = [] if is_final_round else TOOLS

        if is_final_round:
            current_messages.append({
                "role": "system",
                "content": (
                    "You have used the maximum number of tool-call rounds. "
                    "Provide your final answer now based on what you have gathered."
                ),
            })

        accumulated_tool_calls: list[dict] = []

        async for event_type, event_data in provider.stream_with_tools(
            current_messages, tools, model=model
        ):
            if event_type == "token":
                yield ("token", {"content": event_data})
            elif event_type == "tool_calls":
                accumulated_tool_calls = event_data

        if not accumulated_tool_calls:
            # LLM gave a final answer — loop is done
            return

        # Add assistant's tool-call decision to conversation history
        current_messages.append({
            "role": "assistant",
            "content": None,
            "tool_calls": accumulated_tool_calls,
        })

        # Execute each requested tool and feed results back
        for tool_call in accumulated_tool_calls:
            name = tool_call["function"]["name"]
            try:
                args: dict = json.loads(tool_call["function"]["arguments"])
            except (json.JSONDecodeError, ValueError):
                args = {}

            yield ("tool_call", {"tool": name, "args": args})

            result_text = await _execute_tool(
                name, args, db=db, user_id=user_id, matter_id=matter_id
            )
            summary = _tool_result_summary(name, result_text)

            yield ("tool_result", {"tool": name, "summary": summary})

            current_messages.append({
                "role": "tool",
                "tool_call_id": tool_call["id"],
                "content": result_text,
            })
