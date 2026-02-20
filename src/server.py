import logging

import anthropic
from mcp.server.fastmcp import FastMCP

from .config import settings
from .storage import (
    db_connection,
    get_chunks_by_sermon_id,
    get_sermons_by_date,
    init_database,
    search_chunks,
)
from .utils import format_timestamp

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

mcp = FastMCP("sermon-knowledge-base")


@mcp.tool()
def list_sermons(limit: int = 20) -> str:
    """List recently indexed sermons.

    Args:
        limit: Maximum number of sermons to return (default 20)
    """
    with db_connection() as conn:
        rows = conn.execute(
            "SELECT title, date, speaker, url FROM sermons ORDER BY date DESC LIMIT ?",
            (limit,),
        ).fetchall()

        if not rows:
            return "No sermons have been indexed yet. Please contact the administrator to add sermons."

        output = []
        for row in rows:
            output.append(
                f"• {row['title']}\n"
                f"  Date: {row['date']}\n"
                f"  Speaker: {row['speaker'] or 'Unknown'}\n"
                f"  URL: {row['url']}"
            )

        return "\n\n".join(output)


@mcp.tool()
def ask_church(question: str, date_filter: str | None = None) -> str:
    """Ask questions about church teachings from indexed sermons.

    Args:
        question: The question to answer
        date_filter: Optional ISO date or partial date (e.g., '2024-04', '2024-01-15')
    """

    if date_filter:
        sermons = get_sermons_by_date(date_filter)
        if not sermons:
            return f"No sermons found for date filter: {date_filter}"
        results = []
        for s in sermons:
            results.extend(get_chunks_by_sermon_id(s["id"]))
        # Attach sermon metadata
        sermon_map = {s["id"]: s for s in sermons}
        for r in results:
            s = sermon_map[r["sermon_id"]]
            r["sermon_title"] = s["title"]
            r["date"] = s["date"]
            r["url"] = s["url"]
            r["speaker"] = s["speaker"]
    else:
        results = search_chunks(question, limit=10)

    if not results:
        return "No relevant content found. Try ingesting more sermons first."

    context = _build_context(results)

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=2048,
        messages=[
            {
                "role": "user",
                "content": f"""Based on the following sermon excerpts, answer this question:
"{question}"

{context}

Provide a clear answer with citations. For each citation, include the sermon title, date, and timestamp.
If the excerpts don't contain enough information to answer, say so.""",
            }
        ],
    )

    return response.content[0].text


@mcp.tool()
def find_sermon_by_date(date: str) -> str:
    """Find sermon by specific date.

    Args:
        date: ISO date (YYYY-MM-DD) or partial date (YYYY-MM)
    """

    sermons = get_sermons_by_date(date)
    if not sermons:
        return f"No sermons found for date: {date}"

    output = []
    for sermon in sermons:
        chunks = get_chunks_by_sermon_id(sermon["id"])
        outline = "\n".join(
            f"  - {c['section_name']}: {c['summary']}" for c in chunks
        )
        output.append(
            f"Title: {sermon['title']}\n"
            f"Date: {sermon['date']}\n"
            f"Speaker: {sermon['speaker'] or 'Unknown'}\n"
            f"URL: {sermon['url']}\n"
            f"Outline:\n{outline}"
        )

    return "\n\n---\n\n".join(output)


@mcp.tool()
def search_teachings(topic: str, speaker_filter: str | None = None) -> str:
    """Search for teachings on a specific topic across all sermons.

    Args:
        topic: Topic to search for
        speaker_filter: Optional speaker name to filter by
    """

    results = search_chunks(topic, limit=20)

    if speaker_filter:
        results = [
            r for r in results
            if r.get("speaker") and speaker_filter.lower() in r["speaker"].lower()
        ]

    if not results:
        return f"No teachings found on '{topic}'."

    # Group by sermon
    grouped: dict[str, list] = {}
    for r in results:
        key = r["sermon_title"]
        grouped.setdefault(key, []).append(r)

    output = []
    for sermon_title, chunks in grouped.items():
        first = chunks[0]
        sections = "\n".join(
            f"  - {c['section_name']} [{format_timestamp(c['timestamp_start'])}]: {c['summary']}"
            for c in chunks
        )
        output.append(
            f"Sermon: {sermon_title}\n"
            f"Date: {first['date']}\n"
            f"Speaker: {first.get('speaker') or 'Unknown'}\n"
            f"URL: {first['url']}\n"
            f"Relevant sections:\n{sections}"
        )

    return "\n\n---\n\n".join(output)


def _build_context(results: list[dict]) -> str:
    parts = []
    for r in results:
        ts = format_timestamp(r["timestamp_start"])
        parts.append(
            f"[{r['sermon_title']} | {r['date']} | {ts}]\n"
            f"{r['content']}\n"
        )
    return "\n".join(parts)


def main():
    init_database()
    mcp.run()


if __name__ == "__main__":
    main()
