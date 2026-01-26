# Church Sermon Knowledge Base MCP - POC Implementation TODO

## Project Overview
Build an MCP (Model Context Protocol) server that ingests YouTube sermon videos, transcribes them, chunks them semantically, stores them with metadata, and exposes tools for querying church teachings.

---

## 🎯 Objective
Create a working MCP server that:
1. ✅ Ingests YouTube sermon videos and extracts transcripts
2. ✅ Detects and extracts "SERMON" sections from video chapters (or transcribes entire video if not found)
3. ✅ Semantically chunks sermons into logical sections using Claude API
4. ✅ Stores content in PageIndex (vectorless RAG) and metadata in SQLite
5. ✅ Exposes MCP tools for querying church teachings

---

## 📋 Technical Stack

### Core Dependencies
- [x] Python 3.11+
- [x] MCP Python SDK (`mcp`)
- [x] Anthropic SDK (`anthropic`)
- [x] `youtube-transcript-api` for transcription
- [x] `yt-dlp` for video metadata/chapters
- [x] SQLite for metadata
- [x] PageIndex (https://github.com/VectifyAI/PageIndex) for content storage

### Supporting Libraries
- [x] `sqlalchemy` - ORM for cleaner DB operations
- [x] `pydantic` - Data validation
- [x] `python-dateutil` - Date parsing
- [x] `pytest` - Testing

---

## 🗂️ Project Structure

```
sermon-mcp/
├── src/
│   ├── __init__.py
│   ├── server.py              # MCP server with tool definitions
│   ├── ingestion.py           # YouTube processing pipeline
│   ├── chunker.py             # Semantic chunking with Claude
│   ├── storage.py             # SQLite + PageIndex integration
│   └── config.py              # Configuration management
├── data/
│   ├── sermons.db             # SQLite database (created at runtime)
│   └── pageindex/             # PageIndex storage directory (created at runtime)
├── tests/
│   ├── __init__.py
│   └── test_ingestion.py      # Basic tests
├── requirements.txt
├── README.md
├── .env.example
├── .env                       # Your actual environment variables (gitignored)
└── .gitignore
```

---

## ✅ Implementation Checklist

### Phase 1: Project Setup
- [ ] Create project directory structure
- [ ] Initialize git repository
- [ ] Create `requirements.txt` with dependencies:
  ```txt
  mcp>=0.9.0
  anthropic>=0.40.0
  youtube-transcript-api>=0.6.2
  yt-dlp>=2024.1.19
  sqlalchemy>=2.0.25
  pydantic>=2.5.3
  pydantic-settings>=2.1.0
  python-dateutil>=2.8.2
  pytest>=7.4.3
  pytest-asyncio>=0.21.1
  ```
- [ ] Clone and install PageIndex:
  ```bash
  git clone https://github.com/VectifyAI/PageIndex
  cd PageIndex
  pip install -e .
  cd ..
  ```
- [ ] Create `.env.example`:
  ```
  ANTHROPIC_API_KEY=your_api_key_here
  DB_PATH=data/sermons.db
  PAGEINDEX_PATH=data/pageindex
  ```
- [ ] Create `.env` file with actual API key
- [ ] Create `.gitignore`:
  ```
  .env
  __pycache__/
  *.pyc
  .pytest_cache/
  data/sermons.db
  data/pageindex/
  venv/
  .vscode/
  .idea/
  ```

### Phase 2: Configuration (`src/config.py`)
- [ ] Create `Settings` class using Pydantic:
  ```python
  from pydantic_settings import BaseSettings
  
  class Settings(BaseSettings):
      anthropic_api_key: str
      db_path: str = "data/sermons.db"
      pageindex_path: str = "data/pageindex"
      
      class Config:
          env_file = ".env"
  
  settings = Settings()
  ```

### Phase 3: Storage Layer (`src/storage.py`)

#### SQLite Schema
- [ ] Create database initialization function
- [ ] Implement schema:
  ```sql
  CREATE TABLE IF NOT EXISTS sermons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      url TEXT NOT NULL,
      speaker TEXT,
      duration INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sermon_id INTEGER NOT NULL,
      section_name TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp_start REAL NOT NULL,
      timestamp_end REAL NOT NULL,
      topics TEXT,
      summary TEXT,
      FOREIGN KEY (sermon_id) REFERENCES sermons(id)
  );

  CREATE INDEX IF NOT EXISTS idx_sermon_date ON sermons(date);
  CREATE INDEX IF NOT EXISTS idx_sermon_video_id ON sermons(video_id);
  CREATE INDEX IF NOT EXISTS idx_chunk_sermon_id ON chunks(sermon_id);
  ```

#### Database Operations
- [ ] Implement `init_database()` - Initialize SQLite schema
- [ ] Implement `save_sermon(sermon_data: dict) -> int` - Save sermon metadata, return sermon_id
- [ ] Implement `save_chunks(sermon_id: int, chunks: list[dict])` - Save sermon chunks
- [ ] Implement `get_sermon_by_video_id(video_id: str) -> dict | None`
- [ ] Implement `get_sermon_by_date(date: str) -> dict | None`
- [ ] Implement `get_chunks_by_sermon_id(sermon_id: int) -> list[dict]`

#### PageIndex Integration
- [ ] Implement `init_pageindex()` - Initialize PageIndex instance
- [ ] Implement `index_chunks(chunks: list[dict], sermon_metadata: dict)` - Add chunks to PageIndex
- [ ] Implement `search_pageindex(query: str, filters: dict = None) -> list[dict]` - Query PageIndex

### Phase 4: YouTube Ingestion (`src/ingestion.py`)

#### Video Metadata Extraction
- [ ] Implement `get_video_metadata(url: str) -> dict`:
  - Use `yt-dlp` to extract:
    - video_id
    - title
    - upload_date (convert to ISO format)
    - description
    - chapters (if available)
  - Return structured metadata

#### Chapter Detection
- [ ] Implement `detect_sermon_section(chapters: list) -> dict | None`:
  - Search for chapter titles containing "sermon" (case-insensitive)
  - Return `{"start": float, "end": float}` if found, else None

#### Transcript Extraction
- [ ] Implement `get_transcript(video_id: str, section: dict | None) -> list[dict]`:
  - Use `youtube-transcript-api` to get full transcript
  - If section provided, filter to time range
  - Return list of `{"text": str, "start": float, "duration": float}`

#### Main Processing Function
- [ ] Implement `process_youtube_video(url: str, speaker: str = None) -> dict`:
  - Call `get_video_metadata(url)`
  - Call `detect_sermon_section(chapters)`
  - Call `get_transcript(video_id, section)`
  - Return combined data:
    ```python
    {
        "video_id": str,
        "title": str,
        "date": str,  # ISO format YYYY-MM-DD
        "url": str,
        "speaker": str | None,
        "duration": int,
        "transcript": list[dict],
        "sermon_section": dict | None
    }
    ```

### Phase 5: Semantic Chunking (`src/chunker.py`)

#### Transcript Preparation
- [ ] Implement `prepare_transcript_for_chunking(transcript: list[dict]) -> str`:
  - Format transcript with timestamps for Claude
  - Example: `"[00:15] Welcome to church today..."`

#### Claude-based Chunking
- [ ] Implement `chunk_sermon(transcript_data: dict) -> list[dict]`:
  - Initialize Anthropic client
  - Create prompt for Claude:
    ```
    Analyze this sermon transcript and divide it into logical sections.
    For each section, identify:
    1. Section name (e.g., "Introduction", "Main Point 1: Walking by Faith", "Conclusion")
    2. Start and end timestamps (in seconds)
    3. Key topics discussed (3-5 keywords)
    4. Brief summary (1-2 sentences)

    Return ONLY a JSON array with this structure:
    [
      {
        "section_name": "Introduction",
        "timestamp_start": 0.0,
        "timestamp_end": 180.5,
        "key_topics": ["welcome", "worship", "announcements"],
        "summary": "Pastor welcomes congregation and makes announcements."
      },
      ...
    ]

    Transcript:
    {formatted_transcript}
    ```
  - Parse Claude's JSON response
  - For each chunk, extract matching transcript text
  - Return list of enriched chunks

#### Chunk Validation
- [ ] Implement `validate_chunks(chunks: list[dict]) -> list[dict]`:
  - Ensure no overlapping timestamps
  - Ensure complete coverage of sermon
  - Fill gaps if needed

### Phase 6: MCP Server (`src/server.py`)

#### Server Initialization
- [ ] Import required MCP modules
- [ ] Initialize storage (SQLite + PageIndex)
- [ ] Create MCP server instance

#### Tool 1: `ingest_sermon`
- [ ] Define tool schema:
  ```python
  {
      "name": "ingest_sermon",
      "description": "Process and index a YouTube sermon video",
      "input_schema": {
          "type": "object",
          "properties": {
              "url": {
                  "type": "string",
                  "description": "YouTube video URL"
              },
              "speaker": {
                  "type": "string",
                  "description": "Speaker name (optional)"
              }
          },
          "required": ["url"]
      }
  }
  ```
- [ ] Implement handler:
  - Call `process_youtube_video(url, speaker)`
  - Call `chunk_sermon(transcript_data)`
  - Save to SQLite via `save_sermon()` and `save_chunks()`
  - Index in PageIndex via `index_chunks()`
  - Return success message with sermon details

#### Tool 2: `ask_church`
- [ ] Define tool schema:
  ```python
  {
      "name": "ask_church",
      "description": "Ask questions about church teachings from indexed sermons",
      "input_schema": {
          "type": "object",
          "properties": {
              "question": {
                  "type": "string",
                  "description": "The question to answer"
              },
              "date_filter": {
                  "type": "string",
                  "description": "Optional ISO date or range (e.g., '2024-04', '2024-01:2024-06')"
              }
          },
          "required": ["question"]
      }
  }
  ```
- [ ] Implement handler:
  - Parse date_filter if provided
  - Search PageIndex with filters
  - Retrieve top 5-10 relevant chunks
  - Use Claude to synthesize answer from chunks
  - Format citations with video URLs and timestamps
  - Return formatted response:
    ```python
    {
        "answer": str,
        "sources": [
            {
                "sermon_title": str,
                "date": str,
                "timestamp": str,  # "MM:SS"
                "video_url": str,  # with ?t=XXs parameter
                "excerpt": str
            }
        ]
    }
    ```

#### Tool 3: `find_sermon_by_date`
- [ ] Define tool schema:
  ```python
  {
      "name": "find_sermon_by_date",
      "description": "Find sermon by specific date",
      "input_schema": {
          "type": "object",
          "properties": {
              "date": {
                  "type": "string",
                  "description": "ISO date (YYYY-MM-DD) or natural language"
              }
          },
          "required": ["date"]
      }
  }
  ```
- [ ] Implement handler:
  - Parse date (handle natural language like "second Sunday in April 2024")
  - Query SQLite for sermon
  - Return sermon details with outline (chunk summaries)

#### Tool 4: `search_teachings`
- [ ] Define tool schema:
  ```python
  {
      "name": "search_teachings",
      "description": "Search for teachings on a specific topic across all sermons",
      "input_schema": {
          "type": "object",
          "properties": {
              "topic": {
                  "type": "string",
                  "description": "Topic to search for"
              },
              "speaker_filter": {
                  "type": "string",
                  "description": "Optional speaker name to filter by"
              }
          },
          "required": ["topic"]
      }
  }
  ```
- [ ] Implement handler:
  - Search PageIndex for topic
  - Filter by speaker if provided
  - Group results by sermon
  - Return list of sermons with relevant sections

#### Server Run Function
- [ ] Implement `main()`:
  - Initialize all components
  - Register all tools
  - Start MCP server
  - Handle graceful shutdown

### Phase 7: Testing (`tests/test_ingestion.py`)

#### Test Data Setup
- [ ] Define 3 test YouTube URLs:
  1. Video with "SERMON" chapter
  2. Video without chapters
  3. Video with multiple sections

#### Unit Tests
- [ ] Test `get_video_metadata()` with sample URL
- [ ] Test `detect_sermon_section()` with mock chapters
- [ ] Test `get_transcript()` with sample video_id
- [ ] Test `chunk_sermon()` with sample transcript
- [ ] Test database operations (save/retrieve)
- [ ] Test PageIndex integration

#### Integration Tests
- [ ] Test full ingestion pipeline with 1 video
- [ ] Test query with known content
- [ ] Test date-based search

### Phase 8: Documentation

#### README.md
- [ ] Project overview
- [ ] Setup instructions:
  ```bash
  # Clone repository
  git clone <repo_url>
  cd sermon-mcp

  # Create virtual environment
  python -m venv venv
  source venv/bin/activate  # On Windows: venv\Scripts\activate

  # Install dependencies
  pip install -r requirements.txt

  # Install PageIndex
  git clone https://github.com/VectifyAI/PageIndex
  cd PageIndex
  pip install -e .
  cd ..

  # Configure environment
  cp .env.example .env
  # Edit .env and add your ANTHROPIC_API_KEY

  # Initialize database
  python -m src.storage

  # Run MCP server
  python -m src.server
  ```
- [ ] Usage examples for each MCP tool
- [ ] Architecture diagram
- [ ] Troubleshooting section

#### Code Documentation
- [ ] Add docstrings to all functions
- [ ] Add type hints throughout
- [ ] Add inline comments for complex logic

---

## 🧪 POC Testing Scope

### Test Videos
Use 3 sermon videos from your church:
- [ ] Video 1: With clear "SERMON" chapter marker
- [ ] Video 2: Without chapter markers (use full video)
- [ ] Video 3: With multiple teaching sections

### Test Queries
- [ ] "What did the church teach about prayer?"
- [ ] "Find the sermon from the second Sunday in March 2024"
- [ ] "What is CCI's position on tithing?"
- [ ] "Summarize the teaching from [specific date]"
- [ ] "When did Apostle teach about [topic]?"

---

## ✅ Success Criteria

- [x] Successfully extracts "SERMON" sections when available
- [x] Falls back to full transcript when no sermon section detected
- [x] Chunks sermons into 3-7 logical sections
- [x] Stores metadata in SQLite correctly
- [x] Indexes content in PageIndex
- [x] All 4 MCP tools respond correctly
- [x] Answers include relevant citations with video timestamps
- [x] Can handle all 3 test videos
- [x] Basic error handling for missing transcripts
- [x] All tests pass

---

## 🚀 Implementation Order

1. **Day 1**: Setup + Storage Layer
   - Project structure
   - Database schema
   - PageIndex integration
   
2. **Day 2**: Ingestion Pipeline
   - YouTube metadata extraction
   - Transcript retrieval
   - Chapter detection

3. **Day 3**: Semantic Chunking
   - Claude API integration
   - Chunk generation and validation

4. **Day 4**: MCP Server
   - Tool definitions
   - Tool handlers
   - Server setup

5. **Day 5**: Testing & Documentation
   - Write tests
   - Fix bugs
   - Complete README

---

## 📝 Key Implementation Notes

### Error Handling
- [ ] Handle missing transcripts gracefully (some videos may not have captions)
- [ ] Handle rate limiting for Claude API (exponential backoff)
- [ ] Handle yt-dlp failures (geo-restrictions, deleted videos)
- [ ] Validate video URLs before processing

### Logging
- [ ] Set up Python logging
- [ ] Log all YouTube operations
- [ ] Log Claude API calls
- [ ] Log database operations
- [ ] Log errors with stack traces

### Performance Considerations
- [ ] Use async/await for I/O operations
- [ ] Cache video metadata to avoid re-fetching
- [ ] Batch database inserts where possible
- [ ] Set reasonable timeouts for network requests

### Security
- [ ] Never commit `.env` file
- [ ] Validate all user inputs
- [ ] Sanitize video URLs
- [ ] Use parameterized SQL queries

---

## 🔄 Future Enhancements (Post-POC)

- [ ] Web UI for church members
- [ ] Batch ingestion of multiple videos
- [ ] Speaker identification from video metadata
- [ ] Topic tagging and categorization
- [ ] Doctrinal position aggregation
- [ ] Sermon recommendations
- [ ] Export functionality (PDF, text)
- [ ] Search analytics
- [ ] Multi-language support
- [ ] Audio quality analysis
- [ ] Automated weekly ingestion

---

## 📚 Resources

- [MCP Documentation](https://modelcontextprotocol.io/)
- [Anthropic API Docs](https://docs.anthropic.com/)
- [PageIndex GitHub](https://github.com/VectifyAI/PageIndex)
- [youtube-transcript-api](https://github.com/jdepoix/youtube-transcript-api)
- [yt-dlp Documentation](https://github.com/yt-dlp/yt-dlp)

---

## 🐛 Debugging Checklist

If something breaks:
- [ ] Check `.env` file has correct API key
- [ ] Verify database file exists and is writable
- [ ] Check PageIndex directory permissions
- [ ] Verify YouTube URL is accessible
- [ ] Check video has captions/transcripts available
- [ ] Review logs for error messages
- [ ] Test with a different video
- [ ] Verify all dependencies are installed
- [ ] Check Python version (3.11+)

---

**Last Updated:** 2026-01-26
**Status:** Ready for implementation
**Estimated Completion:** 5 days
