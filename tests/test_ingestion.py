import json
import os

import pytest

from src.chunker import prepare_transcript_for_chunking, validate_chunks
from src.ingestion import detect_sermon_section, get_video_metadata, get_transcript
from src.storage import (
    get_chunks_by_sermon_id,
    get_sermon_by_video_id,
    get_sermons_by_date,
    init_database,
    save_chunks,
    save_sermon,
    search_chunks,
)


# ── Storage tests ──────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def fresh_db(tmp_path, monkeypatch):
    db_path = str(tmp_path / "test.db")
    monkeypatch.setattr("src.storage.settings.db_path", db_path)
    init_database()
    yield db_path


def _sample_sermon():
    return {
        "video_id": "abc123",
        "title": "Sunday Service",
        "date": "2024-03-10",
        "url": "https://youtube.com/watch?v=abc123",
        "speaker": "Pastor Test",
        "duration": 3600,
    }


def _sample_chunks():
    return [
        {
            "section_name": "Introduction",
            "content": "Welcome to church today. We will talk about prayer.",
            "timestamp_start": 0.0,
            "timestamp_end": 120.0,
            "key_topics": ["prayer", "welcome"],
            "summary": "Pastor welcomes the congregation.",
        },
        {
            "section_name": "Main Teaching",
            "content": "Faith is the substance of things hoped for. Tithing is an act of obedience.",
            "timestamp_start": 120.0,
            "timestamp_end": 600.0,
            "key_topics": ["faith", "tithing"],
            "summary": "Teaching on faith and tithing.",
        },
    ]


def test_save_and_get_sermon():
    sid = save_sermon(_sample_sermon())
    assert sid > 0

    sermon = get_sermon_by_video_id("abc123")
    assert sermon is not None
    assert sermon["title"] == "Sunday Service"
    assert sermon["speaker"] == "Pastor Test"


def test_duplicate_sermon_rejected():
    save_sermon(_sample_sermon())
    with pytest.raises(Exception):
        save_sermon(_sample_sermon())


def test_save_and_get_chunks():
    sid = save_sermon(_sample_sermon())
    save_chunks(sid, _sample_chunks())

    chunks = get_chunks_by_sermon_id(sid)
    assert len(chunks) == 2
    assert chunks[0]["section_name"] == "Introduction"
    assert chunks[1]["section_name"] == "Main Teaching"


def test_get_sermons_by_date():
    save_sermon(_sample_sermon())

    assert len(get_sermons_by_date("2024-03-10")) == 1
    assert len(get_sermons_by_date("2024-03")) == 1
    assert len(get_sermons_by_date("2024")) == 1
    assert len(get_sermons_by_date("2025")) == 0


def test_search_chunks_fts():
    sid = save_sermon(_sample_sermon())
    save_chunks(sid, _sample_chunks())

    results = search_chunks("prayer")
    assert len(results) >= 1
    assert any("prayer" in r["content"].lower() for r in results)

    results = search_chunks("tithing")
    assert len(results) >= 1

    results = search_chunks("xyznonexistent")
    assert len(results) == 0


# ── Ingestion tests ────────────────────────────────────────────────────────


def test_detect_sermon_section_found():
    chapters = [
        {"title": "PRE SERVICE", "start_time": 0.0, "end_time": 420.0},
        {"title": "SERMON", "start_time": 3606.0, "end_time": 8870.0},
        {"title": "END OF SERVICE", "start_time": 8870.0, "end_time": 9103.0},
    ]
    section = detect_sermon_section(chapters)
    assert section is not None
    assert section["start"] == 3606.0
    assert section["end"] == 8870.0


def test_detect_sermon_section_case_insensitive():
    chapters = [
        {"title": "Worship", "start_time": 0.0, "end_time": 600.0},
        {"title": "The Sermon Today", "start_time": 600.0, "end_time": 3000.0},
    ]
    section = detect_sermon_section(chapters)
    assert section is not None
    assert section["start"] == 600.0


def test_detect_sermon_section_not_found():
    chapters = [
        {"title": "Worship", "start_time": 0.0, "end_time": 600.0},
        {"title": "Announcements", "start_time": 600.0, "end_time": 900.0},
    ]
    assert detect_sermon_section(chapters) is None


def test_detect_sermon_section_empty():
    assert detect_sermon_section([]) is None


# ── Chunker tests ──────────────────────────────────────────────────────────


def test_prepare_transcript_for_chunking():
    transcript = [
        {"text": "Hello church.", "start": 65.0, "duration": 2.0},
        {"text": "Let us pray.", "start": 130.5, "duration": 1.5},
    ]
    formatted = prepare_transcript_for_chunking(transcript)
    assert "[01:05]" in formatted
    assert "[02:10]" in formatted
    assert "Hello church." in formatted


def test_validate_chunks_fills_gaps():
    chunks = [
        {"section_name": "A", "timestamp_start": 0.0, "timestamp_end": 100.0, "content": "a"},
        {"section_name": "B", "timestamp_start": 150.0, "timestamp_end": 300.0, "content": "b"},
    ]
    result = validate_chunks(chunks)
    assert result[0]["timestamp_end"] == 150.0  # gap filled


def test_validate_chunks_fixes_overlaps():
    chunks = [
        {"section_name": "A", "timestamp_start": 0.0, "timestamp_end": 200.0, "content": "a"},
        {"section_name": "B", "timestamp_start": 150.0, "timestamp_end": 300.0, "content": "b"},
    ]
    result = validate_chunks(chunks)
    assert result[0]["timestamp_end"] == 150.0  # trimmed


def test_validate_chunks_sorts_by_start():
    chunks = [
        {"section_name": "B", "timestamp_start": 200.0, "timestamp_end": 300.0, "content": "b"},
        {"section_name": "A", "timestamp_start": 0.0, "timestamp_end": 100.0, "content": "a"},
    ]
    result = validate_chunks(chunks)
    assert result[0]["section_name"] == "A"
    assert result[1]["section_name"] == "B"


# ── Live integration tests (require network) ──────────────────────────────


@pytest.mark.skipif(
    os.environ.get("RUN_LIVE_TESTS") != "1",
    reason="Set RUN_LIVE_TESTS=1 to run live YouTube tests",
)
class TestLiveIngestion:
    def test_get_video_metadata(self):
        meta = get_video_metadata("https://www.youtube.com/live/sXwyenjCGVQ")
        assert meta["video_id"] == "sXwyenjCGVQ"
        assert meta["date"] == "2025-12-05"
        assert len(meta["chapters"]) > 0

    def test_get_transcript(self):
        transcript = get_transcript("sXwyenjCGVQ")
        assert len(transcript) > 0
        assert "text" in transcript[0]

    def test_get_transcript_with_section(self):
        section = {"start": 3606.0, "end": 8870.0}
        transcript = get_transcript("sXwyenjCGVQ", section)
        assert len(transcript) > 0
        assert all(seg["start"] >= 3606.0 for seg in transcript)
        assert all(seg["start"] < 8870.0 for seg in transcript)
