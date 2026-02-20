"""
Admin script for ingesting sermon videos.
Usage: python -m src.admin ingest <youtube_urls...>
"""

import sys
import logging
from .ingestion import process_youtube_video
from .chunker import chunk_sermon
from .storage import (
    init_database,
    get_sermon_by_video_id,
    save_sermon,
    save_chunks,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def ingest_videos(urls: list[str], speaker: str = None) -> None:
    """Ingest multiple sermon videos (admin only)."""
    init_database()

    for i, url in enumerate(urls, 1):
        try:
            logger.info(f"[{i}/{len(urls)}] Processing {url}")

            video_data = process_youtube_video(url, speaker)

            # Check if already ingested
            existing = get_sermon_by_video_id(video_data["video_id"])
            if existing:
                logger.info(f"  ✓ Already ingested: {existing['title']} (id={existing['id']})")
                continue

            # Chunk with Claude
            logger.info(f"  → Chunking sermon with Claude...")
            chunks = chunk_sermon(video_data)

            # Save to database
            sermon_id = save_sermon(video_data)
            save_chunks(sermon_id, chunks)

            section_info = ""
            if video_data["sermon_section"]:
                start = video_data["sermon_section"]["start"]
                end = video_data["sermon_section"]["end"]
                section_info = f" (sermon section: {start:.0f}s - {end:.0f}s)"

            logger.info(
                f"  ✓ Ingested: {video_data['title']}\n"
                f"    Date: {video_data['date']}\n"
                f"    Chunks: {len(chunks)}{section_info}\n"
                f"    Sermon ID: {sermon_id}"
            )

        except Exception as e:
            logger.error(f"  ✗ Failed: {e}")
            import traceback
            logger.debug(traceback.format_exc())


def main():
    if len(sys.argv) < 2:
        print("Sermon-MCP Admin Tool")
        print("=" * 60)
        print("\nUsage: python -m src.admin ingest <youtube_url> [<youtube_url>...] [--speaker <name>]")
        print("\nExamples:")
        print('  # Single video')
        print('  python -m src.admin ingest https://youtube.com/watch?v=abc123 --speaker "Pastor John"')
        print()
        print('  # Multiple videos')
        print('  python -m src.admin ingest \\')
        print('      https://youtube.com/watch?v=abc123 \\')
        print('      https://youtube.com/watch?v=def456 \\')
        print('      --speaker "Apostle Smith"')
        print()
        sys.exit(1)

    if sys.argv[1] != "ingest":
        print(f"Error: Unknown command '{sys.argv[1]}'")
        print("Available commands: ingest")
        sys.exit(1)

    # Parse arguments
    urls = []
    speaker = None

    i = 2
    while i < len(sys.argv):
        if sys.argv[i] == "--speaker":
            if i + 1 >= len(sys.argv):
                print("Error: --speaker requires a value")
                sys.exit(1)
            speaker = sys.argv[i + 1]
            i += 2
        else:
            urls.append(sys.argv[i])
            i += 1

    if not urls:
        print("Error: At least one YouTube URL is required")
        sys.exit(1)

    print(f"\n{'='*60}")
    print(f"Ingesting {len(urls)} sermon video(s)")
    if speaker:
        print(f"Speaker: {speaker}")
    print(f"{'='*60}\n")

    ingest_videos(urls, speaker)

    print(f"\n{'='*60}")
    print("Ingestion complete!")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
