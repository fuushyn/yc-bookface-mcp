# YC Bookface MCP Server

MCP server for interacting with Y Combinator's internal Bookface platform — messaging, posts, knowledge base, and deals.

## Setup

```bash
npm install
npm run build
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `YC_SESSION_COOKIE` | Yes | `_sso.key=...; _bf_session_key=...` from `messages.ycombinator.com` cookies |
| `YC_USER_ID` | For `get_new_messages` | Your numeric Bookface user ID |

Get cookies from DevTools → Application → Cookies on `messages.ycombinator.com`.

## Tools

### Messaging

| Tool | Description |
|------|-------------|
| `create_chat` | Create a new Bookface agent chat thread, optionally with an opening message |
| `send_message` | Send a message to an existing chat thread (fire-and-forget) |
| `send_and_wait` | Send a message and poll until the agent replies (default 120s timeout, 3s interval). Use this when you need the response. |
| `get_new_messages` | Poll for new messages for the authenticated user |
| `get_chat_history` | Get messages for a thread (supports `last_n` limit) |
| `get_thread` | Get metadata for a specific thread |
| `mark_read` | Mark messages as read in a thread |
| `get_suggested_prompts` | Fetch suggested agent prompts from the new chat screen |

### User

| Tool | Description |
|------|-------------|
| `get_current_user` | Get the authenticated user's profile and session info |

### Content

| Tool | Description |
|------|-------------|
| `get_post` | Fetch a Bookface post by ID, including comments |
| `get_knowledge` | Fetch a knowledge base article by slug |

### Deals

| Tool | Description |
|------|-------------|
| `search_deals` | Search YC deals by keyword and/or category tag via Algolia. Returns company name, description, tags, and deal ID. Available tags are returned when browsing without a filter. |
| `get_deal` | Get full deal details by ID, including redemption instructions and terms |
