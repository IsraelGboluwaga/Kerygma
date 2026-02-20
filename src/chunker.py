import json
import logging

import anthropic

from .config import settings
from .utils import format_timestamp

logger = logging.getLogger(__name__)


def prepare_transcript_for_chunking(transcript: list[dict]) -> str:
    lines = []
    for seg in transcript:
        timestamp = format_timestamp(seg["start"])
        lines.append(f"[{timestamp}] {seg['text']}")
    return "\n".join(lines)


def chunk_sermon(transcript_data: dict) -> list[dict]:
    transcript = transcript_data["transcript"]
    formatted = prepare_transcript_for_chunking(transcript)

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        messages=[
            {
                "role": "user",
                "content": f"""Analyze this sermon transcript and divide it into logical sections.
For each section, identify:
1. Section name (e.g., "Introduction", "Main Point 1: Walking by Faith", "Conclusion")
2. Start and end timestamps (in seconds)
3. Key topics discussed (3-5 keywords)
4. Brief summary (1-2 sentences)

Return ONLY a JSON array with this structure:
[
  {{
    "section_name": "Introduction",
    "timestamp_start": 0.0,
    "timestamp_end": 180.5,
    "key_topics": ["welcome", "worship", "announcements"],
    "summary": "Pastor welcomes congregation and makes announcements."
  }}
]

Transcript:
{formatted}""",
            }
        ],
    )

    text = response.content[0].text
    # Strip markdown code fences if present
    if text.startswith("```"):
        text = text.split("\n", 1)[1]
        text = text.rsplit("```", 1)[0]

    chunks = json.loads(text)

    # Attach the actual transcript text to each chunk
    for chunk in chunks:
        chunk["content"] = _extract_chunk_text(
            transcript, chunk["timestamp_start"], chunk["timestamp_end"]
        )

    return validate_chunks(chunks)


def _extract_chunk_text(transcript: list[dict], start: float, end: float) -> str:
    return " ".join(
        seg["text"]
        for seg in transcript
        if seg["start"] >= start and seg["start"] < end
    )


def validate_chunks(chunks: list[dict]) -> list[dict]:
    # Sort by start time
    chunks.sort(key=lambda c: c["timestamp_start"])

    # Fix gaps: extend each chunk's end to the next chunk's start
    for i in range(len(chunks) - 1):
        if chunks[i]["timestamp_end"] < chunks[i + 1]["timestamp_start"]:
            chunks[i]["timestamp_end"] = chunks[i + 1]["timestamp_start"]

    # Fix overlaps: trim end to next start
    for i in range(len(chunks) - 1):
        if chunks[i]["timestamp_end"] > chunks[i + 1]["timestamp_start"]:
            chunks[i]["timestamp_end"] = chunks[i + 1]["timestamp_start"]

    return chunks
