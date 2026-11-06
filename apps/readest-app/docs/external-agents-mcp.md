# External agents over MCP (Claude Code and others)

Wellread runs an [MCP](https://modelcontextprotocol.io) server, so an agent
you already use, such as Claude Code or any other MCP client, can help you read.
It works on the book open in Wellread and has the same tools as the built-in
Reading Assistant, plus live views of what you are doing in the reader.

It works only **while Wellread is open with AI enabled**: the server lives in
the local eve sidecar, which runs only when Settings → AI → Enable AI is on.
You do not need an API key for this. External agents bring their own model.

## Connect Claude Code

1. Open Wellread → Settings → AI → **External Agents (MCP)** → Claude Code →
   **Copy**. The copied command looks like this:

   ```bash
   claude mcp add --scope user wellread -- /Applications/Wellread.app/Contents/MacOS/node /Applications/Wellread.app/Contents/Resources/eve/.output/server/mcpBridge.mjs --endpoint-file '/Users/<you>/Library/Application Support/com.bilingify.wellread/eve/mcp-endpoint.json'
   ```

   Use the copied command rather than typing this one: it has the exact paths
   for your install.

2. Run it once in a terminal. `--scope user` makes Wellread available in every
   project. Check it with:

   ```bash
   claude mcp list
   ```

3. Open a book in Wellread, start `claude`, and ask, for example:
   - "What's going on in the passage I'm reading?"
   - "Explain what I selected"
   - "Summarize this chapter and save it to my notes"
   - "Quiz me on what I've read so far"

   Skills appear as slash commands: `/mcp__wellread__explain`,
   `/mcp__wellread__socratic-check`, `/mcp__wellread__note`, and so on, along
   with any skills you imported.

If Claude Code started before Wellread, run `/mcp` in Claude Code and reconnect
`wellread`.

## Other MCP clients

Settings → AI → External Agents (MCP) → Other MCP clients → **Copy** gives an
`mcpServers` JSON entry (stdio: `command` + `args`). Paste it into the client's
MCP config file, for example Claude Desktop's `claude_desktop_config.json`,
Cursor's `mcp.json`, or the config of any desktop agent that accepts stdio MCP
servers.

## What the agent can do

| Tool | What it does |
| --- | --- |
| `get_reading_state` | The open book, your position, the page on screen (`focus_text`), selected and queued quotes with their extract chunks, the current section, spoiler guard and your reader memory. It returns the same `<reading_context>` the built-in assistant gets. |
| `get_selection` | The text you have selected right now, plus quotes you queued with **Ask about this**. |
| `read_file`, `read_section_text`, `resolve_section`, `search_book`, `grep`, `glob` | Read and search this book's text (the extract). |
| `search_library` | Search what you wrote about other books (notes, annotations, memory). |
| `write_file`, `remember` | Save notes for this book and remember facts about you and your reading. |

The settings you set for the Reading Assistant apply to external agents too:

- **Spoiler guard** hides text past your position.
- **Share highlights and notes** controls whether your annotations are exported
  and readable.
- Writes stay inside `Books/.wellread/`.

## How it works

```
Claude Code ──stdio──▶ mcpBridge.mjs ──HTTP POST /mcp──▶ eve sidecar ──▶ Books/.wellread
                         (reads mcp-endpoint.json)          ▲
                                                Wellread UI pushes live reader state
                                                (PUT /eve/v1/reader/live)
```

- The sidecar listens on `127.0.0.1` with a random port. Each time it starts,
  it writes `mcp-endpoint.json` (mode 0600) under its data directory with the
  URL and a separate **MCP-only token**. The bridge reads that file on every
  message, so sidecar restarts after a model change are invisible to the client.
  The token opens `/mcp` and nothing else. Requests that carry an `Origin`
  header are refused.
- While a book is open, the reader pushes the book, position, selection,
  Pending Quotes and assistant settings to the sidecar. The focused window wins.
  The annotations export is refreshed when your highlights change.
- When Wellread is closed, the bridge answers every request with "Wellread is
  not running".

Code: `apps/eve-sidecar/src/server/mcp.mjs` (protocol + tools),
`mcpBridge.mjs`, `mcpEndpoint.mjs`, `readerLive.mjs`. Front end:
`src/app/reader/hooks/useReaderLivePublisher.ts`,
`src/components/settings/ExternalAgentsSection.tsx`.
