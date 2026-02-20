import logging
from datetime import datetime

import yt_dlp
from youtube_transcript_api import YouTubeTranscriptApi

from .config import settings

logger = logging.getLogger(__name__)


class VideoTooLongError(Exception):
    """Raised when a video exceeds the maximum allowed duration."""


def get_video_metadata(url: str) -> dict:
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)

    upload_date = info.get("upload_date", "")
    if upload_date:
        date_iso = datetime.strptime(upload_date, "%Y%m%d").strftime("%Y-%m-%d")
    else:
        date_iso = ""

    return {
        "video_id": info["id"],
        "title": info.get("title", ""),
        "date": date_iso,
        "url": url,
        "duration": info.get("duration", 0),
        "chapters": info.get("chapters") or [],
    }


def detect_sermon_section(chapters: list) -> dict | None:
    for i, ch in enumerate(chapters):
        if "sermon" in ch.get("title", "").lower():
            end = chapters[i + 1]["start_time"] if i + 1 < len(chapters) else ch.get("end_time")
            return {"start": ch["start_time"], "end": end}
    return None


def get_transcript(video_id: str, section: dict | None = None) -> list[dict]:
    api = YouTubeTranscriptApi()
    fetched = api.fetch(video_id)

    transcript = [
        {"text": s.text, "start": s.start, "duration": s.duration}
        for s in fetched
    ]

    if section:
        transcript = [
            seg for seg in transcript
            if seg["start"] >= section["start"]
            and seg["start"] < section["end"]
        ]

    return transcript


def process_youtube_video(url: str, speaker: str | None = None) -> dict:
    metadata = get_video_metadata(url)

    max_duration = settings.max_video_duration_seconds
    if metadata["duration"] > max_duration:
        duration_min = metadata["duration"] // 60
        limit_min = max_duration // 60
        raise VideoTooLongError(
            f"{metadata['title']!r} is {duration_min} min — exceeds {limit_min}-min limit"
        )

    sermon_section = detect_sermon_section(metadata["chapters"])
    transcript = get_transcript(metadata["video_id"], sermon_section)

    return {
        "video_id": metadata["video_id"],
        "title": metadata["title"],
        "date": metadata["date"],
        "url": metadata["url"],
        "speaker": speaker,
        "duration": metadata["duration"],
        "transcript": transcript,
        "sermon_section": sermon_section,
    }
