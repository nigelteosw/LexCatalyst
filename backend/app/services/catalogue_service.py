"""LLM extraction of structured catalogue fields from a document.

Runs as a second step in the Knowledge Bank worker, after the formatted text is
ready. Every extracted value carries a locator (page or clause) and a short
quote so a reviewer can check it. Values the model cannot find are null, never
guessed. Extraction failures are logged and leave the entry without a catalogue
rather than failing the entry.

Document text is sent to the user's OpenRouter model, like the formatting step.
"""

import asyncio
import json
import logging
import re
from datetime import date
from typing import Any

logger = logging.getLogger(__name__)

DOCUMENT_TYPES = (
    "NDA",
    "SPA",
    "OTP",
    "Shareholders' agreement",
    "Lease",
    "Letter",
    "Other",
)
DOCUMENT_STATUSES = ("Draft", "Signed", "Expired", "Unknown")

# Single-value fields every document is checked for. Type-specific extras are
# returned by the model under "type_fields" and stored as-is after validation.
COMMON_SINGLE_FIELDS = (
    "governing_law",
    "jurisdiction",
    "term",
    "liability_cap",
    "confidentiality_period",
)

MAX_ITEMS = 50
MAX_TEXT = 500


_SYSTEM_PROMPT = """\
You catalogue legal documents for a knowledge base. You read document text and \
return structured fields as JSON. You never guess: if a field is not stated in \
the text, return null for it. Every value you return must be supported by a \
short verbatim quote from the text and a locator (page number or clause number \
if present, otherwise "unspecified")."""

_USER_PROMPT = """\
Catalogue the document below.

Return ONLY valid JSON with this shape (no markdown fences, no commentary):
{{
  "document_type": one of {document_types},
  "document_status": one of {document_statuses},
  "execution_date": "YYYY-MM-DD" or null,
  "parties": [{{"name": "...", "role": "...", "locator": "...", "quote": "..."}}],
  "key_dates": [{{"label": "...", "date": "YYYY-MM-DD or as written", "locator": "...", "quote": "..."}}],
  "amounts": [{{"label": "...", "value": "...", "currency": "...", "locator": "...", "quote": "..."}}],
  "fields": {{
    "governing_law": {{"value": "...", "locator": "...", "quote": "..."}} or null,
    "jurisdiction": {{"value": "...", "locator": "...", "quote": "..."}} or null,
    "term": {{"value": "...", "locator": "...", "quote": "..."}} or null,
    "liability_cap": {{"value": "...", "locator": "...", "quote": "..."}} or null,
    "confidentiality_period": {{"value": "...", "locator": "...", "quote": "..."}} or null
  }},
  "type_fields": {{
    "<snake_case_name>": {{"value": "...", "locator": "...", "quote": "..."}}
  }}
}}

Type-specific fields to look for, depending on document_type:
- SPA / share deals: target_company, shares_sold, completion_conditions, warranty_cap, retention_amount
- OTP / HDB resale: property_address, sale_price, option_fee, exercise_date, completion_date
- NDA: purpose, permitted_disclosees, carve_outs, non_solicit_period
- Lease: premises, rent, deposit, break_clause

Use an empty list for list fields with nothing found, and null for single fields \
with nothing found. Leave type_fields empty if the document type has none.

Filename: {filename}

Document text ({char_count} chars):
{raw_text}\
"""


def build_catalogue_prompt(*, filename: str, raw_text: str, max_chars: int) -> list[dict[str, str]]:
    truncated = raw_text[:max_chars]
    return [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {
            "role": "user",
            "content": _USER_PROMPT.format(
                document_types=json.dumps(list(DOCUMENT_TYPES)),
                document_statuses=json.dumps(list(DOCUMENT_STATUSES)),
                filename=filename,
                char_count=len(truncated),
                raw_text=truncated,
            ),
        },
    ]


_FENCED = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL)


def _strip_fences(content: str) -> str:
    match = _FENCED.search(content)
    cleaned = (match.group(1) if match else content).strip()
    first = cleaned.find("{")
    return cleaned[first:] if first > 0 else cleaned


def _text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text[:MAX_TEXT] if text else None


def _evidence(value: Any) -> dict[str, str] | None:
    """Normalise one {value, locator, quote} record. Returns None when the value is missing."""
    if not isinstance(value, dict):
        return None
    shown = _text(value.get("value"))
    if not shown:
        return None
    return {
        "value": shown,
        "locator": _text(value.get("locator")) or "unspecified",
        "quote": _text(value.get("quote")) or "",
    }


def _items(value: Any, keys: tuple[str, ...], required: str) -> list[dict[str, str]]:
    """Keep list items that have their required field; drop the rest."""
    if not isinstance(value, list):
        return []
    out: list[dict[str, str]] = []
    for raw in value[:MAX_ITEMS]:
        if not isinstance(raw, dict):
            continue
        item: dict[str, str] = {}
        for key in keys:
            text = _text(raw.get(key))
            if text:
                item[key] = text
        if required not in item:
            continue
        item.setdefault("locator", _text(raw.get("locator")) or "unspecified")
        item.setdefault("quote", _text(raw.get("quote")) or "")
        out.append(item)
    return out


def _parse_date(value: Any) -> date | None:
    text = _text(value)
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def parse_catalogue_response(content: str) -> dict[str, Any]:
    """Validate the model's JSON and return the normalised catalogue.

    Raises ValueError if the response is not usable JSON. Unknown document types
    become "Other" and unknown statuses become "Unknown", so the filter columns
    only ever hold values from the agreed lists.
    """
    try:
        data = json.loads(_strip_fences(content))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Catalogue returned invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError("Catalogue JSON was not an object.")

    document_type = data.get("document_type")
    if document_type not in DOCUMENT_TYPES:
        document_type = "Other"
    document_status = data.get("document_status")
    if document_status not in DOCUMENT_STATUSES:
        document_status = "Unknown"

    raw_fields = data.get("fields") if isinstance(data.get("fields"), dict) else {}
    fields = {name: _evidence(raw_fields.get(name)) for name in COMMON_SINGLE_FIELDS}

    raw_type_fields = data.get("type_fields") if isinstance(data.get("type_fields"), dict) else {}
    type_fields = {}
    for name, value in list(raw_type_fields.items())[:MAX_ITEMS]:
        evidence = _evidence(value)
        if evidence and isinstance(name, str) and name.strip():
            type_fields[name.strip()[:60]] = evidence

    return {
        "document_type": document_type,
        "document_status": document_status,
        "execution_date": _parse_date(data.get("execution_date")),
        "fields": fields,
        "parties": _items(data.get("parties"), ("name", "role"), required="name"),
        "key_dates": _items(data.get("key_dates"), ("label", "date"), required="date"),
        "amounts": _items(data.get("amounts"), ("label", "value", "currency"), required="value"),
        "type_fields": type_fields,
    }


def catalogue_to_json(catalogue: dict[str, Any]) -> dict[str, Any]:
    """Make the normalised catalogue JSON-serialisable for the catalogue_fields column."""
    out = dict(catalogue)
    out["execution_date"] = catalogue["execution_date"].isoformat() if catalogue["execution_date"] else None
    return out


async def extract_catalogue(provider, *, filename: str, raw_text: str, max_chars: int, timeout: float) -> dict[str, Any] | None:
    """Run the extraction on an existing provider. Returns None on any failure."""
    try:
        content, _ = await asyncio.wait_for(
            provider.chat(build_catalogue_prompt(filename=filename, raw_text=raw_text, max_chars=max_chars)),
            timeout=timeout,
        )
        return parse_catalogue_response(content)
    except Exception as exc:  # noqa: BLE001 - extraction must never fail the entry
        logger.warning("Catalogue extraction skipped for %s: %s", filename, exc)
        return None
