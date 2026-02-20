# Kerygma

> A Model Context Protocol (MCP) server that transforms YouTube sermon videos into a searchable knowledge base with AI-powered Q&A.

**Kerygma** (κήρυγμα) - Greek word meaning "proclamation" or "preaching of the gospel"

[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Overview

Kerygma is a church knowledge base system that allows administrators to ingest YouTube sermon videos and enables church members to ask questions about church teachings through an MCP interface. The system intelligently chunks sermons using Claude AI and provides answers with citations and timestamps.

### Key Features

- **Admin-Controlled Ingestion** - Church administrators manually add sermon videos to the knowledge base
- **Smart Sermon Detection** - Automatically detects "SERMON" sections in videos using chapter markers
- **AI-Powered Chunking** - Uses Claude to semantically divide sermons into logical sections
- **Full-Text Search** - SQLite FTS5 for fast content searching
- **Claude-Powered Q&A** - Church members ask questions and get synthesized answers with citations
- **Date-Based Queries** - Find sermons by specific dates or date ranges
- **Topic Search** - Search teachings across all sermons by topic or speaker

## Architecture

```
┌─────────────────────────────────────────────────────┐
│              ADMIN (Church Leadership)              │
│  Manually ingests sermon videos using admin script  │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
              ┌──────────────┐
              │ Admin Script │
              │  (src/admin) │
              └──────┬───────┘
                     │
    ┌────────────────┼────────────────┐
    │                │                │
    ▼                ▼                ▼
┌────────┐    ┌──────────┐    ┌──────────┐
│yt-dlp  │    │ Chunker  │    │ Storage  │
│youtube-│───▶│ (Claude) │───▶│ (SQLite) │
│trans.  │    │          │    │  + FTS5  │
└────────┘    └──────────┘    └──────────┘
                                     │
                     ┌───────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│           MCP Server (Public Interface)             │
│  Tools: ask_church, find_sermon_by_date,           │
│         search_teachings, list_sermons              │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│          CHURCH MEMBERS (MCP Clients)               │
│  Ask questions about church teachings via Claude    │
└─────────────────────────────────────────────────────┘
```

## Installation

### Prerequisites

- Python 3.11 or higher
- Anthropic API key ([get one here](https://console.anthropic.com/))

### Setup

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd kerygma
   ```

2. **Create virtual environment**
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

4. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env and add your ANTHROPIC_API_KEY
   ```

   Your `.env` should look like:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   DB_PATH=data/sermons.db
   ```

5. **Initialize database**
   ```bash
   python -m src.storage
   ```

## Usage

### For Church Administrators

Church administrators use the admin script to build and maintain the sermon knowledge base.

#### Ingesting Sermons (Manual Approach)

**Option 1: Command Line (Single or Multiple Videos)**

```bash
# Single video
python -m src.admin ingest https://youtube.com/watch?v=VIDEO_ID --speaker "Apostle Emmanuel Iren"

# Multiple videos
python -m src.admin ingest \
    https://youtube.com/watch?v=VIDEO_1 \
    https://youtube.com/watch?v=VIDEO_2 \
    https://youtube.com/watch?v=VIDEO_3 \
    --speaker "Apostle Smith"
```

**Option 2: Using the Batch File**

1. Edit `sermons_to_ingest.txt` and add YouTube URLs:
   ```
   # Sermon Videos to Ingest
   https://youtube.com/watch?v=abc123
   https://youtube.com/watch?v=def456
   https://youtube.com/watch?v=ghi789
   ```

2. Run the ingestion:
   ```bash
   # Linux/Mac
   python -m src.admin ingest $(grep -v "^#" sermons_to_ingest.txt) --speaker "Apostle Emmanuel Iren"

   # Windows PowerShell
   python -m src.admin ingest (Get-Content sermons_to_ingest.txt | Where-Object { $_ -notmatch "^#" }) --speaker "Apostle Emmanuel Iren"
   ```

3. After successful ingestion, remove or comment out the processed URLs

**Weekly Workflow:**

Every week after a new sermon is uploaded:
1. Copy the YouTube URL
2. Run: `python -m src.admin ingest <URL> --speaker "Pastor Name"`
3. Verify ingestion was successful
4. The sermon is now available for church members to query

**Example Output:**
```
============================================================
Kerygma - Ingesting 2 sermon video(s)
Speaker: Apostle Emmanuel Iren
============================================================

INFO:src.admin:[1/2] Processing https://youtube.com/watch?v=abc123
INFO:src.admin:  → Chunking sermon with Claude...
INFO:src.admin:  ✓ Ingested: Sunday Morning Service - Faith and Prayer
    Date: 2024-03-10
    Chunks: 5 (sermon section: 3606s - 8870s)
    Sermon ID: 1

INFO:src.admin:[2/2] Processing https://youtube.com/watch?v=def456
INFO:src.admin:  ✓ Already ingested: Midweek Service (id=2)

============================================================
Ingestion complete!
============================================================
```

---

### For Church Members

Church members connect to the MCP server via Claude Desktop (or any MCP client) to query the sermon knowledge base.

#### MCP Client Configuration

Add to your MCP client settings (e.g., `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "kerygma": {
      "command": "python",
      "args": ["-m", "src.server"],
      "cwd": "/path/to/kerygma",
      "env": {
        "ANTHROPIC_API_KEY": "your-api-key",
        "DB_PATH": "data/sermons.db"
      }
    }
  }
}
```

#### Available MCP Tools

**1. `list_sermons` - Browse Available Sermons**

See what sermons have been indexed.

```
User: What sermons are available?
User: Show me recent sermons
```

**Output:**
```
• Sunday Morning Service - Faith and Prayer
  Date: 2024-03-10
  Speaker: Apostle Emmanuel Iren
  URL: https://youtube.com/watch?v=abc123

• Midweek Service - Prayer and Fasting
  Date: 2024-03-06
  Speaker: Apostle Smith
  URL: https://youtube.com/watch?v=def456
```

---

**2. `ask_church` - Ask Questions About Teachings**

Ask questions and get AI-generated answers with citations.

```
User: What does our church teach about tithing?
User: What is the church's position on prayer?
User: What did Apostle Emmanuel Iren say about faith in March?
```

**Parameters:**
- `question` (required): The question to answer
- `date_filter` (optional): Filter by date (e.g., '2024-03', '2024-01-15')

**Example Output:**
```
Based on the sermon excerpts, the church teaches that tithing is an act
of obedience and faith. In the Sunday Morning Service (2024-03-10),
Apostle Emmanuel Iren explained that "tithing is not just about money, it's about
trusting God with our finances" [62:15].

The teaching emphasizes that when we give our first fruits to God, we
demonstrate faith that He will provide for our needs...

Citations:
- Sunday Morning Service (2024-03-10) at 62:15
- Midweek Teaching on Generosity (2024-02-28) at 45:30
```

---

**3. `find_sermon_by_date` - Find Sermons by Date**

Locate sermons from specific dates.

```
User: What sermon did we have on March 10th?
User: Find sermons from March 2024
User: Show me the sermon from 2024-03-10
```

**Parameters:**
- `date` (required): ISO date (YYYY-MM-DD) or partial date (YYYY-MM)

**Example Output:**
```
Title: Sunday Morning Service - Faith and Prayer
Date: 2024-03-10
Speaker: Apostle Emmanuel Iren
URL: https://youtube.com/watch?v=abc123
Outline:
  - Introduction: Welcome and opening prayer
  - Main Point 1: Defining Biblical Faith: Teaching on Hebrews 11:1
  - Main Point 2: The Power of Prayer: Importance of consistent prayer life
  - Application: How to apply faith in daily life
  - Conclusion: Altar call and closing prayer
```

---

**4. `search_teachings` - Search by Topic**

Search for specific topics across all sermons.

```
User: Find all teachings about prayer
User: Search for sermons about spiritual warfare
User: What has Apostle Emmanuel Iren taught about faith?
```

**Parameters:**
- `topic` (required): Topic to search for
- `speaker_filter` (optional): Filter by speaker name

**Example Output:**
```
Sermon: Sunday Morning Service - Faith and Prayer
Date: 2024-03-10
Speaker: Apostle Emmanuel Iren
URL: https://youtube.com/watch?v=abc123
Relevant sections:
  - Main Point 2: The Power of Prayer [62:06]: Teaching on consistent prayer
  - Application [78:15]: Practical steps for developing a prayer life

---

Sermon: Midweek Service - Prayer and Fasting
Date: 2024-03-06
Speaker: Apostle Smith
URL: https://youtube.com/watch?v=def456
Relevant sections:
  - Introduction [05:30]: The biblical foundation of prayer
  - Main Teaching [15:45]: Types of prayer in Scripture
```

---

## Project Structure

```
kerygma/
├── src/
│   ├── __init__.py
│   ├── admin.py               # Admin ingestion script (manual)
│   ├── server.py              # MCP server with query tools
│   ├── ingestion.py           # YouTube processing pipeline
│   ├── chunker.py             # Semantic chunking with Claude
│   ├── storage.py             # SQLite + FTS5 integration
│   └── config.py              # Configuration management
├── data/                       # Created at runtime
│   └── sermons.db             # SQLite database
├── tests/
│   ├── __init__.py
│   └── test_ingestion.py      # Test suite
├── sermons_to_ingest.txt      # Template for batch ingestion
├── requirements.txt
├── pyproject.toml
├── .env.example
├── .env                       # Your environment variables (gitignored)
└── README.md
```

## How It Works

### 1. Admin Ingestion Process

When an administrator runs the ingestion command:

1. **Video Metadata Extraction** - Uses `yt-dlp` to extract video info (title, date, chapters)
2. **Sermon Detection** - Automatically detects "SERMON" sections in video chapters
3. **Transcript Retrieval** - Uses `youtube-transcript-api` to fetch captions
4. **AI Chunking** - Claude analyzes the sermon and divides it into logical sections
5. **Storage** - Saves to SQLite with full-text search indexing

### 2. Semantic Chunking

Each sermon is divided into chunks with:
- **Section name** (e.g., "Introduction", "Main Point 1: Walking by Faith")
- **Timestamps** (start/end in seconds)
- **Key topics** (3-5 keywords)
- **Summary** (1-2 sentences)
- **Full transcript text**

### 3. Storage & Search

- **SQLite** stores sermon metadata and chunks
- **FTS5** (Full-Text Search) enables fast keyword searching
- **Automatic indexing** via database triggers
- **Foreign key constraints** ensure data integrity

### 4. Querying

When church members ask questions:
1. Query uses FTS5 to find relevant chunks
2. Top results retrieved with sermon metadata
3. Claude synthesizes a comprehensive answer
4. Citations include sermon title, date, and timestamp

---

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | Anthropic API key (required) | - |
| `DB_PATH` | Path to SQLite database | `data/sermons.db` |

### Database Schema

**sermons table:**
- `id` - Primary key
- `video_id` - YouTube video ID (unique)
- `title` - Video title
- `date` - Upload date (ISO format)
- `url` - YouTube URL
- `speaker` - Speaker name (optional)
- `duration` - Video duration in seconds
- `created_at` - Timestamp

**chunks table:**
- `id` - Primary key
- `sermon_id` - Foreign key to sermons
- `section_name` - Section title
- `content` - Transcript text
- `timestamp_start` - Start time in seconds
- `timestamp_end` - End time in seconds
- `topics` - JSON array of keywords
- `summary` - Brief description

---

## Development

### Running Tests

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=src

# Run live integration tests (requires network)
RUN_LIVE_TESTS=1 pytest
```

### Test Structure
- `tests/test_ingestion.py` - Storage, ingestion, and chunking tests
- Unit tests use temporary in-memory databases
- Live tests marked with `@pytest.mark.skipif` (opt-in)

---

## Examples

### Example 1: Admin Ingesting a New Sermon

```bash
$ python -m src.admin ingest https://www.youtube.com/watch?v=sXwyenjCGVQ --speaker "Apostle Emmanuel Iren"

============================================================
Kerygma - Ingesting 1 sermon video(s)
Speaker: Apostle Emmanuel Iren
============================================================

INFO:src.admin:[1/1] Processing https://www.youtube.com/watch?v=sXwyenjCGVQ
INFO:src.admin:  → Chunking sermon with Claude...
INFO:src.admin:  ✓ Ingested: Sunday Morning Service - March 10, 2024
    Date: 2024-03-10
    Chunks: 5 (sermon section: 3606s - 8870s)
    Sermon ID: 1

============================================================
Ingestion complete!
============================================================
```

### Example 2: Church Member Asking Questions

```
User: What does our church teach about prayer?

Claude: Based on the sermon excerpts from our church, prayer is taught as
a vital spiritual discipline that connects us with God. In the Sunday
Morning Service from March 10, 2024, Apostle Emmanuel Iren emphasized that "prayer
is not just talking to God, but listening for His voice" [62:15].

The teaching highlights several key aspects:

1. **Consistency** - The importance of daily prayer habits
2. **Faith** - Praying with expectation that God hears and answers
3. **Surrender** - Aligning our will with God's purposes

Citations:
- Sunday Morning Service (2024-03-10) at 62:15 - The Power of Prayer
- Midweek Service (2024-03-06) at 45:30 - Building a Prayer Life
```

### Example 3: Finding Sermons by Topic

```
User: Find all teachings about faith

Claude: I found several sermons that discuss faith:

**Sunday Morning Service - Faith and Prayer**
Date: 2024-03-10
Speaker: Apostle Emmanuel Iren
URL: https://youtube.com/watch?v=abc123
Relevant sections:
- Main Point 1: Defining Biblical Faith [60:06]: Deep dive into Hebrews 11
- Application [78:15]: How to live by faith daily

**Wednesday Night Bible Study**
Date: 2024-02-28
Speaker: Apostle Smith
URL: https://youtube.com/watch?v=def456
Relevant sections:
- Introduction [05:30]: Faith as the foundation of Christian life
- Main Teaching [20:15]: Examples of faith from Scripture
```

---

## Troubleshooting

### Common Issues

**Issue:** `ModuleNotFoundError: No module named 'src'`
- **Solution:** Make sure you're running from the project root directory

**Issue:** `AttributeError: 'NoneType' object has no attribute 'text'`
- **Solution:** Video may not have captions/transcripts available. Try a different video.

**Issue:** `sqlite3.OperationalError: database is locked`
- **Solution:** Close any other processes accessing the database

**Issue:** `anthropic.AuthenticationError`
- **Solution:** Check that your `ANTHROPIC_API_KEY` in `.env` is correct

**Issue:** Video processing fails with "This video is not available"
- **Solution:** Check if the video is public and accessible in your region

**Issue:** No sermons shown when using `list_sermons`
- **Solution:** Admin needs to ingest sermons first using `python -m src.admin ingest`

### Debug Mode

Enable detailed logging:
```python
import logging
logging.basicConfig(level=logging.DEBUG)
```

---

## Limitations

- **Manual ingestion required** - Admins must manually add each sermon
- **YouTube-only** - Currently only supports YouTube videos
- **English transcripts** - Works best with English captions
- **Public videos** - Cannot access private or age-restricted content
- **No speaker auto-detection** - Speaker must be manually specified

---

## Security & Access Control

- **Admin access** - Ingestion script runs locally, requires server access
- **Read-only MCP** - Church members can only query, not modify data
- **API key required** - Both admin and MCP server need Anthropic API key
- **No authentication** - MCP server assumes trusted network (add auth if deploying publicly)

---

## Future Enhancements

- [ ] Web UI for both admins and church members
- [ ] Automated ingestion from church YouTube channel RSS
- [ ] Speaker identification from video metadata
- [ ] Multi-language support
- [ ] Export functionality (PDF, text)
- [ ] Sermon recommendations based on topics
- [ ] Doctrinal position aggregation
- [ ] Search analytics dashboard
- [ ] Role-based access control
- [ ] Email notifications when new sermons are added

---

## License

MIT License - see LICENSE file for details

## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Write tests for new functionality
4. Submit a pull request

---

## Resources

- [MCP Documentation](https://modelcontextprotocol.io/)
- [Anthropic API Docs](https://docs.anthropic.com/)
- [youtube-transcript-api](https://github.com/jdepoix/youtube-transcript-api)
- [yt-dlp Documentation](https://github.com/yt-dlp/yt-dlp)

---

## Support

For issues and questions:
- Open an issue on GitHub
- Check existing issues for solutions
- Review the troubleshooting section

---

**Built with:** Python, FastMCP, Claude AI, SQLite, yt-dlp

**Status:** Production-ready for church knowledge base deployment

**Use Case:** Church administrators build a sermon knowledge base; church members query teachings via Claude

---

**Kerygma** (κήρυγμα) - From the Greek word for "proclamation," Kerygma makes the preached word searchable and accessible to your congregation.
