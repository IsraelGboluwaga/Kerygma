# Church Sermon Knowledge Base MCP - Implementation Status

## Project Overview
Build an MCP (Model Context Protocol) server that ingests YouTube sermon videos, transcribes them, chunks them semantically, stores them with metadata, and exposes tools for querying church teachings.

**Architecture Approach:** Admin-controlled ingestion with public query-only MCP interface.

---

## 🎯 Objective (COMPLETED ✅)
Create a working MCP server that:
1. ✅ Ingests YouTube sermon videos and extracts transcripts
2. ✅ Detects and extracts "SERMON" sections from video chapters (or transcribes entire video if not found)
3. ✅ Semantically chunks sermons into logical sections using Claude API
4. ✅ Stores content in SQLite with FTS5 (Full-Text Search) for vectorless RAG
5. ✅ Exposes MCP tools for querying church teachings (read-only for public)
6. ✅ Provides admin script for controlled ingestion

---

## 📋 Technical Stack

### Core Dependencies
- [x] Python 3.11+
- [x] MCP Python SDK (`mcp`)
- [x] Anthropic SDK (`anthropic`)
- [x] `youtube-transcript-api` for transcription
- [x] `yt-dlp` for video metadata/chapters
- [x] SQLite for metadata
- [x] SQLite FTS5 for full-text search (instead of PageIndex)

### Supporting Libraries
- [x] `pydantic` - Data validation
- [x] `pydantic-settings` - Configuration management
- [x] `python-dateutil` - Date parsing
- [x] `pytest` - Testing

### Notable Changes from Original Plan
- ❌ **PageIndex** - Not used; using SQLite FTS5 instead (simpler, no external dependencies)
- ❌ **SQLAlchemy** - Not used; using raw SQLite3 (simpler for this use case)
- ✅ **FastMCP** - Using FastMCP for easier MCP server implementation

---

## 🗂️ Project Structure

```
sermon-mcp/
├── src/
│   ├── __init__.py
│   ├── admin.py               # ✅ Admin ingestion script (manual)
│   ├── server.py              # ✅ MCP server with query tools only
│   ├── ingestion.py           # ✅ YouTube processing pipeline
│   ├── chunker.py             # ✅ Semantic chunking with Claude
│   ├── storage.py             # ✅ SQLite + FTS5 integration
│   └── config.py              # ✅ Configuration management
├── data/
│   └── sermons.db             # ✅ SQLite database (created at runtime)
├── tests/
│   ├── __init__.py
│   └── test_ingestion.py      # ✅ Comprehensive test suite
├── sermons_to_ingest.txt      # ✅ Template for batch ingestion
├── requirements.txt           # ✅
├── pyproject.toml             # ✅
├── README.md                  # ✅ Complete documentation
├── .env.example               # ✅
├── .env                       # ✅ (user-created, gitignored)
└── .gitignore                 # ✅
```

---

## ✅ Implementation Status

### Phase 1: Project Setup ✅
- [x] Create project directory structure
- [x] Initialize git repository
- [x] Create `requirements.txt` with dependencies
- [x] Create `pyproject.toml` for package management
- [x] Create `.env.example`
- [x] Create `.env` file with actual API key
- [x] Create comprehensive `.gitignore`

### Phase 2: Configuration (`src/config.py`) ✅
- [x] Create `Settings` class using Pydantic
- [x] Load environment variables from `.env`
- [x] Support for `ANTHROPIC_API_KEY` and `DB_PATH`

### Phase 3: Storage Layer (`src/storage.py`) ✅

#### SQLite Schema
- [x] Create database initialization function
- [x] Implement complete schema with sermons and chunks tables
- [x] Add indexes for performance (date, video_id, sermon_id)
- [x] Implement FTS5 virtual table for full-text search
- [x] Create triggers for automatic FTS5 indexing

#### Database Operations
- [x] Implement `init_database()` - Initialize SQLite schema
- [x] Implement `save_sermon(sermon_data: dict) -> int` - Save sermon metadata
- [x] Implement `save_chunks(sermon_id: int, chunks: list[dict])` - Save chunks
- [x] Implement `get_sermon_by_video_id(video_id: str) -> dict | None`
- [x] Implement `get_sermons_by_date(date: str) -> list[dict]`
- [x] Implement `get_chunks_by_sermon_id(sermon_id: int) -> list[dict]`
- [x] Implement `search_chunks(query: str, limit: int) -> list[dict]` - FTS5 search

### Phase 4: YouTube Ingestion (`src/ingestion.py`) ✅

#### Video Metadata Extraction
- [x] Implement `get_video_metadata(url: str) -> dict`
  - Uses `yt-dlp` to extract video_id, title, date, chapters, duration
  - Converts upload_date to ISO format

#### Chapter Detection
- [x] Implement `detect_sermon_section(chapters: list) -> dict | None`
  - Case-insensitive search for "sermon" in chapter titles
  - Returns start/end timestamps or None

#### Transcript Extraction
- [x] Implement `get_transcript(video_id: str, section: dict | None) -> list[dict]`
  - Uses `youtube-transcript-api`
  - Filters to sermon section if provided
  - Returns timestamped segments

#### Main Processing Function
- [x] Implement `process_youtube_video(url: str, speaker: str = None) -> dict`
  - Combines all ingestion steps
  - Returns structured data with metadata, transcript, and sermon section

### Phase 5: Semantic Chunking (`src/chunker.py`) ✅

#### Transcript Preparation
- [x] Implement `prepare_transcript_for_chunking(transcript: list[dict]) -> str`
  - Formats transcript with timestamps for Claude

#### Claude-based Chunking
- [x] Implement `chunk_sermon(transcript_data: dict) -> list[dict]`
  - Sends formatted transcript to Claude API
  - Parses JSON response with sections, timestamps, topics, summaries
  - Extracts full transcript text for each chunk

#### Chunk Validation
- [x] Implement `validate_chunks(chunks: list[dict]) -> list[dict]`
  - Sorts chunks by timestamp
  - Fills gaps between chunks
  - Fixes overlapping timestamps

### Phase 6: MCP Server (`src/server.py`) ✅

#### Server Initialization
- [x] Import FastMCP
- [x] Initialize database on startup
- [x] Create MCP server instance

#### Public Query Tools (Read-Only for Church Members)
- [x] Tool: `list_sermons` - Browse available sermons
- [x] Tool: `ask_church` - AI-powered Q&A with citations
- [x] Tool: `find_sermon_by_date` - Find sermons by date
- [x] Tool: `search_teachings` - Search by topic with speaker filter

#### Admin Ingestion (Separate Script)
- [x] Created `src/admin.py` - Command-line admin tool
- [x] Supports single or multiple video URLs
- [x] `--speaker` flag for speaker name
- [x] Detailed logging and progress tracking
- [x] Duplicate detection
- [x] Error handling per video

### Phase 7: Testing (`tests/test_ingestion.py`) ✅

#### Test Data Setup
- [x] Sample test data functions
- [x] Temporary database fixtures

#### Unit Tests
- [x] Test `get_video_metadata()` (live, opt-in)
- [x] Test `detect_sermon_section()` with mock chapters
- [x] Test `get_transcript()` (live, opt-in)
- [x] Test `chunk_sermon()` validation logic
- [x] Test database operations (save/retrieve)
- [x] Test FTS5 search functionality
- [x] Test date filtering

#### Integration Tests
- [x] Live YouTube integration tests (opt-in with RUN_LIVE_TESTS=1)
- [x] End-to-end ingestion pipeline tests

### Phase 8: Documentation ✅

#### README.md
- [x] Project overview with architecture diagram
- [x] Clear separation: Admin vs. Church Members usage
- [x] Complete setup instructions
- [x] Admin ingestion workflow (manual approach)
- [x] MCP client configuration examples
- [x] All 4 MCP tools documented with examples
- [x] Database schema documentation
- [x] Troubleshooting section
- [x] Development and testing guide

#### Code Documentation
- [x] Docstrings for all public functions
- [x] Type hints throughout
- [x] Inline comments for complex logic

#### Additional Documentation
- [x] `sermons_to_ingest.txt` - Batch ingestion template
- [x] `.env.example` - Environment variable template

---

## 🧪 Testing Status

### Test Coverage
- [x] Storage layer fully tested
- [x] Ingestion pipeline tested (unit + integration)
- [x] Chunking validation tested
- [x] FTS5 search tested
- [x] Live YouTube tests (opt-in)

### Test Execution
```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=src

# Run live integration tests
RUN_LIVE_TESTS=1 pytest
```

---

## ✅ Success Criteria (ALL MET)

- [x] Successfully extracts "SERMON" sections when available
- [x] Falls back to full transcript when no sermon section detected
- [x] Chunks sermons into logical sections (typically 3-7)
- [x] Stores metadata in SQLite correctly
- [x] Indexes content in FTS5 for fast searching
- [x] All 4 MCP query tools respond correctly
- [x] Answers include relevant citations with video timestamps
- [x] Admin can manually ingest videos via command-line script
- [x] Church members have read-only query access via MCP
- [x] Basic error handling for missing transcripts
- [x] All tests pass
- [x] Comprehensive documentation

---

## 🚀 Current Status

**Status:** ✅ **COMPLETE - PRODUCTION READY**

**Completion Date:** 2026-02-19

**Implementation Approach:**
- **Admin Interface:** Command-line script (`python -m src.admin ingest`) for controlled ingestion
- **Public Interface:** MCP server with 4 read-only query tools
- **Storage:** SQLite + FTS5 (simpler than PageIndex, no external dependencies)
- **Chunking:** Claude API for semantic analysis

---

## 📝 Key Implementation Notes

### Design Decisions

1. **Admin-Controlled Ingestion**
   - Ingestion separated from public MCP interface
   - Admins use `src/admin.py` script locally
   - Church members get read-only query access
   - Ensures quality control and prevents unauthorized content

2. **SQLite FTS5 vs. PageIndex**
   - Chose SQLite FTS5 over PageIndex for simplicity
   - No external dependencies
   - Built-in full-text search capabilities
   - Automatic indexing via triggers
   - Sufficient for vectorless RAG use case

3. **Manual Ingestion Workflow**
   - Weekly manual ingestion after sermons are uploaded
   - Batch file support for multiple videos
   - Prevents automated ingestion errors
   - Admin reviews each sermon before indexing

### Error Handling ✅
- [x] Handle missing transcripts gracefully
- [x] Handle yt-dlp failures (deleted videos, geo-restrictions)
- [x] Validate video URLs before processing
- [x] Per-video error handling in batch ingestion
- [x] Detailed logging with error messages

### Logging ✅
- [x] Python logging configured
- [x] Log all YouTube operations
- [x] Log Claude API calls
- [x] Log database operations
- [x] Log errors with context

### Performance ✅
- [x] Database indexes for fast queries
- [x] FTS5 for optimized full-text search
- [x] Batch database inserts
- [x] Efficient chunk validation

### Security ✅
- [x] `.env` file gitignored
- [x] Input validation (URL limits, date formats)
- [x] Parameterized SQL queries (prevents injection)
- [x] Read-only MCP interface for public users
- [x] Admin-only ingestion script

---

## 🔄 Future Enhancements (Post-POC)

### High Priority
- [ ] Web UI for church members (easier than MCP client setup)
- [ ] Web-based admin interface for ingestion
- [ ] Automated weekly ingestion from church YouTube channel RSS
- [ ] Email notifications when new sermons are added

### Medium Priority
- [ ] Speaker identification from video metadata
- [ ] Multi-language transcript support
- [ ] Sermon recommendations based on topics
- [ ] Doctrinal position aggregation
- [ ] Export functionality (PDF, text, markdown)

### Low Priority
- [ ] Search analytics dashboard
- [ ] Role-based access control (if deployed publicly)
- [ ] Audio quality analysis
- [ ] Topic categorization and tagging
- [ ] Sermon series detection

---

## 🐛 Known Limitations

- **Manual ingestion required** - Admins must manually add each sermon (by design)
- **YouTube-only** - Only supports YouTube videos
- **English transcripts** - Works best with English captions
- **Public videos** - Cannot access private or age-restricted content
- **No speaker auto-detection** - Speaker must be manually specified
- **Sequential processing** - Videos processed one at a time (not parallel)

---

## 📚 Resources

- [MCP Documentation](https://modelcontextprotocol.io/)
- [Anthropic API Docs](https://docs.anthropic.com/)
- [youtube-transcript-api](https://github.com/jdepoix/youtube-transcript-api)
- [yt-dlp Documentation](https://github.com/yt-dlp/yt-dlp)
- [SQLite FTS5 Documentation](https://www.sqlite.org/fts5.html)

---

## 🎉 Project Summary

**What Was Built:**
A production-ready church sermon knowledge base system with:
- Admin-controlled ingestion via command-line script
- AI-powered semantic chunking using Claude
- Fast full-text search using SQLite FTS5
- Read-only MCP interface for church members
- Comprehensive test suite
- Complete documentation

**Technology Stack:**
- Python 3.11+
- FastMCP for MCP server
- Claude Sonnet 4.5 for chunking and Q&A
- SQLite + FTS5 for storage and search
- yt-dlp + youtube-transcript-api for YouTube integration

**Use Case:**
Church administrators manually ingest sermon videos weekly. Church members ask questions about church teachings via Claude Desktop (MCP client), receiving AI-generated answers with citations and timestamps.

**Status:** Ready for deployment and production use.

---

**Last Updated:** 2026-02-19
**Project Status:** ✅ COMPLETE - PRODUCTION READY
**Next Steps:** Deploy, ingest initial sermon corpus, distribute MCP connection info to church members
