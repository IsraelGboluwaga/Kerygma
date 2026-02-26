# Connecting Claude to Kerygma MCP

## Local (Claude Desktop)

Claude Desktop reads `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS.

Add the following entry under `mcpServers`:

```json
{
  "mcpServers": {
    "kerygma": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

**Steps**

1. Start the server locally:
   ```bash
   yarn dev
   ```
2. Open (or create) `~/Library/Application Support/Claude/claude_desktop_config.json` and paste the config above.
3. Quit and relaunch Claude Desktop — it connects automatically on startup.
4. Verify: open a new conversation and ask *"list my sermons"*. Claude will call the `list_sermons` tool.

> The server must be running before Claude Desktop launches, otherwise the connection attempt fails silently. Restart Claude Desktop if you start the server afterwards.

---

## Online / Deployed (Claude.ai or any MCP-compatible client)

Once the app is deployed (e.g. on Railway), the MCP endpoint is publicly reachable over HTTPS.

### Claude.ai (Projects → Custom Instructions → MCP)

1. In Claude.ai, open **Settings → Integrations** (or the project you want to connect).
2. Add a new MCP server:
   - **Name:** `kerygma`
   - **URL:** `https://your-app.railway.app/mcp`
   - **Transport:** `Streamable HTTP`
3. Save. Claude.ai will discover the tools automatically.

### Generic MCP client config

```json
{
  "mcpServers": {
    "kerygma": {
      "type": "http",
      "url": "https://your-app.railway.app/mcp"
    }
  }
}
```

Replace `your-app.railway.app` with the actual Railway / Render domain.

---

## Available Tools

| Tool | What it does |
|---|---|
| `list_sermons` | Lists recently indexed sermons |
| `ask_church` | Answers a question using sermon content, with citations. Accepts optional `date_filter` and `speaker_filter` |
| `summarise_sermon` | Full Claude-written summary of a sermon by date. Accepts optional `speaker`. Suggests nearest date if exact match not found |
| `search_teachings` | Finds teachings on a topic across all sermons. Accepts optional `speaker_filter` |

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Tools don't appear in Claude Desktop | Restart Claude Desktop after editing the config |
| `connection refused` on local | Run `yarn dev` first, then (re)launch Claude Desktop |
| `401 Unauthorized` on deployed endpoint | The `/mcp` route does not require auth — check firewall / Railway sleep settings |
| Stale tool responses | The server may be mid-ingestion; wait for the job to complete |
