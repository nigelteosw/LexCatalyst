"""Searches eLitigation (https://www.elitigation.sg), Singapore's public court judgments site.

Only the search phrase leaves for eLitigation; no document or client text is sent there.
"""

import asyncio
import re
import time
from dataclasses import dataclass

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.elitigation.sg"
SEARCH_URL = f"{BASE_URL}/gd/Home/Index"
USER_AGENT = "LexCatalyst-Birdie/0.1 (+https://lexcatalyst.pages.dev)"
TIMEOUT_SECONDS = 10
CACHE_TTL_SECONDS = 3600
MAX_EXCERPT_CHARS = 4000

_JUDGMENT_PATH = re.compile(r"^/gd/s/\d{4}_[A-Z]+_\d+$")
_DECISION_DATE = re.compile(r'DecisionDate:"(\d{4}-\d{2}-\d{2})"')
_PARAGRAPH_NUMBER = re.compile(r"^(\d+)\s+(.*)$", re.S)
_WORD = re.compile(r"[a-z]{3,}")

_cache: dict[str, tuple[float, str]] = {}


class ElitigationError(Exception):
    pass


@dataclass(frozen=True)
class Judgment:
    citation: str
    title: str
    decision_date: str | None
    url: str
    catchwords: list[str]


@dataclass(frozen=True)
class JudgmentExcerpt:
    judgment: Judgment
    paragraphs: list[tuple[str, str]]


def _clean(text: str) -> str:
    return " ".join(text.split())


def _get(url: str, params: dict[str, str] | None = None) -> str:
    key = f"{url}?{sorted((params or {}).items())!r}"
    cached = _cache.get(key)
    if cached and time.monotonic() - cached[0] < CACHE_TTL_SECONDS:
        return cached[1]
    try:
        response = requests.get(
            url, params=params, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT_SECONDS
        )
        response.raise_for_status()
    except requests.RequestException as exc:
        raise ElitigationError(f"eLitigation request failed: {exc}") from exc
    _cache[key] = (time.monotonic(), response.text)
    return response.text


def parse_search_results(html: str, limit: int) -> list[Judgment]:
    soup = BeautifulSoup(html, "html.parser")
    results: list[Judgment] = []
    for card in soup.select("div.card-body.gd"):
        link = card.select_one("a.gd-heardertext")
        href = str(link.get("href", "")) if link else ""
        if not link or not _JUDGMENT_PATH.match(href):
            continue
        citation_el = card.select_one("a.citation-num-link")
        citation = _clean(citation_el.get_text()).rstrip("|").strip() if citation_el else ""
        if not citation:
            continue
        date_el = card.select_one("a.decision-date-link")
        date_match = _DECISION_DATE.search(str(date_el.get("data-searchparam", ""))) if date_el else None
        results.append(
            Judgment(
                citation=citation,
                title=_clean(link.get_text()),
                decision_date=date_match.group(1) if date_match else None,
                url=f"{BASE_URL}{href}",
                catchwords=[_clean(a.get_text()).strip("[]") for a in card.select("a.gd-cw")],
            )
        )
        if len(results) >= limit:
            break
    return results


def parse_judgment_paragraphs(html: str) -> list[tuple[str, str]]:
    soup = BeautifulSoup(html, "html.parser")
    paragraphs: list[tuple[str, str]] = []
    for p in soup.select("p.Judg-1, div.Judg-1"):
        match = _PARAGRAPH_NUMBER.match(_clean(p.get_text(" ")))
        if match:
            paragraphs.append((match.group(1), match.group(2)))
    return paragraphs


def best_paragraphs(
    paragraphs: list[tuple[str, str]], query: str, max_chars: int = MAX_EXCERPT_CHARS
) -> list[tuple[str, str]]:
    terms = set(_WORD.findall(query.lower()))
    scored = [
        (len(terms & set(_WORD.findall(text.lower()))), index)
        for index, (_, text) in enumerate(paragraphs)
    ]
    chosen: list[int] = []
    used = 0
    for score, index in sorted(scored, key=lambda item: (-item[0], item[1])):
        if score == 0:
            break
        length = len(paragraphs[index][1])
        if used + length > max_chars:
            continue
        chosen.append(index)
        used += length
    return [paragraphs[index] for index in sorted(chosen)]


async def search_judgments(
    query: str, limit: int = 5, *, newest_first: bool = False, year: int | None = None,
) -> list[Judgment]:
    params = {
        "Filter": "SUPCT",
        "YearOfDecision": str(year) if year is not None else "All",
        "SortBy": "DateOfDecision" if newest_first else "Score",
        "SearchPhrase": query,
        "CurrentPage": "1",
        "SortAscending": "False",
        "PageSize": "0",
        "Verbose": "False",
        "SearchQueryTime": "0",
        "SearchTotalHits": "0",
        "SearchMode": "True",
        "SpanMultiplePage": "False",
    }
    html = await asyncio.to_thread(_get, SEARCH_URL, params)
    return parse_search_results(html, limit)


async def fetch_judgment_excerpt(judgment: Judgment, query: str) -> JudgmentExcerpt:
    if not judgment.url.startswith(f"{BASE_URL}/gd/s/"):
        raise ElitigationError(f"Not an eLitigation judgment URL: {judgment.url}")
    html = await asyncio.to_thread(_get, judgment.url)
    return JudgmentExcerpt(judgment, best_paragraphs(parse_judgment_paragraphs(html), query))
