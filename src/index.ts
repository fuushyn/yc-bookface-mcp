import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { randomUUID } from "crypto";
import { z } from "zod";
import { authedFetch } from "./auth.js";

const MESSAGES_BASE = "https://messages.ycombinator.com";
const BOOKFACE_BASE = "https://bookface.ycombinator.com";

const server = new McpServer({
  name: "yc-bookface",
  version: "1.0.0",
});

// ── create_chat ─────────────────────────────────────────────────────────────

server.tool(
  "create_chat",
  "Create a new YC Bookface agent chat thread and optionally send an opening message",
  {
    message: z
      .string()
      .optional()
      .describe("Opening message to send (omit to just create the thread)"),
  },
  async ({ message }) => {
    const body: Record<string, unknown> = {
      user_ids: [3241775],
      name: "",
      visibility: "private",
    };
    if (message) {
      body.message = {
        content: message,
        media_uploads: [],
        client_message_id: randomUUID(),
        version_number: 2,
      };
    }

    const createRes = await authedFetch(`${MESSAGES_BASE}/messages`, {
      method: "POST",
      body: JSON.stringify({ chat: body }),
    });
    if (!createRes.ok) {
      const text = await createRes.text();
      return error(`Failed to create thread (${createRes.status}): ${text}`);
    }

    const thread = await createRes.json();
    const threadId = thread.id;
    return ok(
      message
        ? `Thread ${threadId} created and message sent.`
        : `Thread ${threadId} created.`
    );
  }
);

// ── create_chat_and_wait ──────────────────────────────────────────────────

server.tool(
  "create_chat_and_wait",
  "Create a new Bookface agent chat thread, send an opening message, and poll until the agent replies. This is the PRIMARY tool for starting a new conversation when you need the response.",
  {
    message: z.string().describe("Opening message to send"),
    timeout_seconds: z
      .number()
      .default(120)
      .describe("Max seconds to wait for a reply (default 120)"),
  },
  async ({ message, timeout_seconds }) => {
    // Create thread with message
    const body: Record<string, unknown> = {
      user_ids: [3241775],
      name: "",
      visibility: "private",
      message: {
        content: message,
        media_uploads: [],
        client_message_id: randomUUID(),
        version_number: 2,
      },
    };

    const createRes = await authedFetch(`${MESSAGES_BASE}/messages`, {
      method: "POST",
      body: JSON.stringify({ chat: body }),
    });
    if (!createRes.ok) {
      const text = await createRes.text();
      return error(`Failed to create thread (${createRes.status}): ${text}`);
    }

    const thread = await createRes.json();
    const threadId = thread.id;

    // Poll for agent reply
    const deadline = Date.now() + timeout_seconds * 1000;
    const pollInterval = 3000;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollInterval));

      const histRes = await authedFetch(
        `${MESSAGES_BASE}/messages/${threadId}/chat_messages`
      );
      if (!histRes.ok) continue;

      const histData = await histRes.json();
      const msgs = Array.isArray(histData)
        ? histData
        : (histData as any).chat_messages ?? (histData as any).messages ?? [];
      if (!Array.isArray(msgs)) continue;

      // We sent 1 message, so need at least 2 (our msg + reply)
      if (msgs.length >= 2) {
        const reply = msgs[msgs.length - 1] as any;
        return ok(
          JSON.stringify(
            {
              thread_id: threadId,
              reply: {
                id: reply.id,
                content: reply.content,
                sender: reply.user?.full_name ?? reply.sender_name ?? "Agent",
                created_at: reply.created_at,
              },
              total_messages: msgs.length,
            },
            null,
            2
          )
        );
      }
    }

    return error(
      `Thread ${threadId} created and message sent, but no reply after ${timeout_seconds}s. Try get_chat_history on thread ${threadId} later.`
    );
  }
);

// ── send_message ────────────────────────────────────────────────────────────

server.tool(
  "send_message",
  "Send a message to a Bookface chat thread WITHOUT waiting for a reply (fire-and-forget). IMPORTANT: If you need the agent's response, use send_and_wait instead — this tool does NOT return the reply.",
  {
    thread_id: z.number().describe("The thread/conversation ID"),
    message: z.string().describe("Message body"),
  },
  async ({ thread_id, message }) => {
    const res = await authedFetch(
      `${MESSAGES_BASE}/messages/${thread_id}/chat_messages`,
      {
        method: "POST",
        body: JSON.stringify({
          chat_message: {
            chat_id: thread_id,
            content: message,
            media_uploads: [],
            client_message_id: randomUUID(),
            version_number: 2,
            thread_id: null,
            referrer: `${MESSAGES_BASE}/messages/${thread_id}`,
          },
        }),
      }
    );
    if (!res.ok) return error(`Send failed (${res.status})`);
    return ok(`Message sent to thread ${thread_id}.`);
  }
);

// ── send_and_wait ─────────────────────────────────────────────────────────

server.tool(
  "send_and_wait",
  "Send a message to a Bookface agent chat thread and poll until the agent replies. This is the PRIMARY tool for chatting — always use this instead of send_message + get_chat_history.",
  {
    thread_id: z.number().describe("The thread/conversation ID"),
    message: z.string().describe("Message body"),
    timeout_seconds: z
      .number()
      .default(120)
      .describe("Max seconds to wait for a reply (default 120)"),
  },
  async ({ thread_id, message, timeout_seconds }) => {
    // Get current message count so we know what's new
    const beforeRes = await authedFetch(
      `${MESSAGES_BASE}/messages/${thread_id}/chat_messages`
    );
    let beforeCount = 0;
    if (beforeRes.ok) {
      const beforeData = await beforeRes.json();
      const beforeMsgs = Array.isArray(beforeData)
        ? beforeData
        : (beforeData as any).chat_messages ?? (beforeData as any).messages ?? [];
      beforeCount = Array.isArray(beforeMsgs) ? beforeMsgs.length : 0;
    }

    // Send the message
    const sendRes = await authedFetch(
      `${MESSAGES_BASE}/messages/${thread_id}/chat_messages`,
      {
        method: "POST",
        body: JSON.stringify({
          chat_message: {
            chat_id: thread_id,
            content: message,
            media_uploads: [],
            client_message_id: randomUUID(),
            version_number: 2,
            thread_id: null,
            referrer: `${MESSAGES_BASE}/messages/${thread_id}`,
          },
        }),
      }
    );
    if (!sendRes.ok) return error(`Send failed (${sendRes.status})`);

    // Poll for a new message (agent reply)
    const deadline = Date.now() + timeout_seconds * 1000;
    const pollInterval = 3000; // 3 seconds

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollInterval));

      const histRes = await authedFetch(
        `${MESSAGES_BASE}/messages/${thread_id}/chat_messages`
      );
      if (!histRes.ok) continue;

      const histData = await histRes.json();
      const msgs = Array.isArray(histData)
        ? histData
        : (histData as any).chat_messages ?? (histData as any).messages ?? [];
      if (!Array.isArray(msgs)) continue;

      // Check if there are new messages beyond what we sent
      // We sent 1 message, so we need at least beforeCount + 2 (our msg + reply)
      if (msgs.length >= beforeCount + 2) {
        const reply = msgs[msgs.length - 1] as any;
        return ok(
          JSON.stringify(
            {
              thread_id,
              reply: {
                id: reply.id,
                content: reply.content,
                sender: reply.user?.full_name ?? reply.sender_name ?? "Agent",
                created_at: reply.created_at,
              },
              total_messages: msgs.length,
            },
            null,
            2
          )
        );
      }
    }

    return error(
      `No reply received after ${timeout_seconds}s. The agent may still be generating — try get_chat_history on thread ${thread_id} later.`
    );
  }
);

// ── get_new_messages ────────────────────────────────────────────────────────

server.tool(
  "get_new_messages",
  "Poll for new messages for the authenticated user",
  {
    user_id: z
      .string()
      .optional()
      .describe("User ID (defaults to YC_USER_ID env var)"),
  },
  async ({ user_id }) => {
    const uid = user_id || process.env.YC_USER_ID;
    if (!uid) return error("No user_id provided and YC_USER_ID not set.");

    const res = await authedFetch(`${MESSAGES_BASE}/user/${uid}/new_messages`);
    if (!res.ok) return error(`Poll failed (${res.status})`);
    return ok(JSON.stringify(await res.json(), null, 2));
  }
);

// ── get_chat_history ────────────────────────────────────────────────────────

server.tool(
  "get_chat_history",
  "Get chat messages for a given thread",
  {
    thread_id: z.number().describe("The thread/conversation ID"),
    last_n: z
      .number()
      .optional()
      .default(10)
      .describe("Return only the last N messages (default 10)"),
  },
  async ({ thread_id, last_n }) => {
    const res = await authedFetch(
      `${MESSAGES_BASE}/messages/${thread_id}/chat_messages`
    );
    if (!res.ok) return error(`Fetch history failed (${res.status})`);
    const data = await res.json();
    const raw = Array.isArray(data)
      ? data
      : (data as any).chat_messages ?? (data as any).messages ?? [];
    const messages: unknown[] = Array.isArray(raw) ? raw : [];
    const slice = messages.slice(-last_n);
    return ok(JSON.stringify(slice, null, 2));
  }
);

// ── get_thread ──────────────────────────────────────────────────────────────

server.tool(
  "get_thread",
  "Get metadata for a specific Bookface thread",
  {
    thread_id: z.number().describe("The thread/conversation ID"),
  },
  async ({ thread_id }) => {
    const res = await authedFetch(
      `${MESSAGES_BASE}/messages/${thread_id}.json`
    );
    if (!res.ok) return error(`Fetch thread failed (${res.status})`);
    return ok(JSON.stringify(await res.json(), null, 2));
  }
);

// ── get_suggested_prompts ───────────────────────────────────────────────────

server.tool(
  "get_suggested_prompts",
  "Fetch suggested agent prompts shown on the new chat screen",
  {
    count: z.number().default(2).describe("Number of prompts to fetch"),
  },
  async ({ count }) => {
    const [fastRes, slowRes] = await Promise.all([
      authedFetch(
        `${MESSAGES_BASE}/messages/agent_prompts_fast.json?count=${count}`
      ),
      authedFetch(
        `${MESSAGES_BASE}/messages/agent_prompts_slow.json?count=${count}`
      ),
    ]);
    const fast = fastRes.ok ? await fastRes.json() : null;
    const slow = slowRes.ok ? await slowRes.json() : null;
    return ok(JSON.stringify({ fast, slow }, null, 2));
  }
);

// ── mark_read ───────────────────────────────────────────────────────────────

server.tool(
  "mark_read",
  "Mark messages as read in a thread",
  {
    thread_id: z.number().describe("The thread/conversation ID"),
    message_id: z.number().describe("The last read message ID"),
  },
  async ({ thread_id, message_id }) => {
    const res = await authedFetch(
      `${MESSAGES_BASE}/messages/${thread_id}/set_last_read_message_id`,
      { method: "POST", body: JSON.stringify({ message_id }) }
    );
    if (!res.ok) return error(`Mark read failed (${res.status})`);
    return ok("Messages marked as read.");
  }
);

// ── get_current_user ────────────────────────────────────────────────────────

server.tool(
  "get_current_user",
  "Get the authenticated user's profile and session info",
  {},
  async () => {
    const res = await authedFetch(
      `${MESSAGES_BASE}/user/current_user.json`
    );
    if (!res.ok) return error(`Fetch user failed (${res.status})`);
    return ok(JSON.stringify(await res.json(), null, 2));
  }
);

// ── get_post ─────────────────────────────────────────────────────────────────

server.tool(
  "get_post",
  "Fetch a Bookface post by numeric ID (e.g. from bookface.ycombinator.com/posts/83782)",
  {
    post_id: z.number().describe("The numeric post ID"),
  },
  async ({ post_id }) => {
    const res = await authedFetch(
      `${BOOKFACE_BASE}/posts/${post_id}.json`,
      { headers: { Referer: `${BOOKFACE_BASE}/posts/${post_id}` } }
    );
    if (!res.ok) return error(`Fetch post failed (${res.status})`);
    const data = await res.json() as any;
    const p = data.post ?? data;
    const out = {
      id: p.id,
      title: p.title,
      body: p.body,
      author: p.user?.full_name,
      company: p.user?.byline_company?.name,
      created_at: p.created_at,
      upvotes: p.vote_info?.count ?? p.upvotes_count,
      comments: (p.comments ?? []).map((c: any) => ({
        id: c.id,
        author: c.user?.full_name,
        body: c.body,
        created_at: c.created_at,
      })),
    };
    return ok(JSON.stringify(out, null, 2));
  }
);

// ── get_knowledge ─────────────────────────────────────────────────────────────

server.tool(
  "get_knowledge",
  "Fetch a Bookface knowledge base article by slug (e.g. 'BJ-founder-sales' from bookface.ycombinator.com/knowledge/BJ-founder-sales)",
  {
    slug: z.string().describe("The knowledge article slug"),
  },
  async ({ slug }) => {
    const res = await authedFetch(
      `${BOOKFACE_BASE}/knowledge/${slug}.json`,
      { headers: { Referer: `${BOOKFACE_BASE}/knowledge/${slug}` } }
    );
    if (!res.ok) return error(`Fetch knowledge failed (${res.status})`);
    const data = await res.json() as any;
    // Knowledge articles can be large — trim each post to key fields
    const posts: any[] = data.posts ?? data.knowledge_posts ?? (Array.isArray(data) ? data : [data]);
    const out = posts.map((p: any) => ({
      id: p.id,
      title: p.title,
      body: typeof p.body === "string" ? p.body.slice(0, 2000) : p.body,
      author: p.user?.full_name,
      upvotes: p.vote_info?.count ?? p.upvotes_count,
      url: `${BOOKFACE_BASE}/posts/${p.id}`,
    }));
    return ok(JSON.stringify(out, null, 2));
  }
);

// ── Algolia deals search ──────────────────────────────────────────────────

const ALGOLIA_APP_ID = "45BWZJ1SGC";
const ALGOLIA_URL = `https://${ALGOLIA_APP_ID.toLowerCase()}-dsn.algolia.net/1/indexes/*/queries?x-algolia-application-id=${ALGOLIA_APP_ID}`;

let algoliaKeyCache: { key: string; ts: number } | null = null;

/**
 * Extract the Algolia secured API key from the Bookface deals page.
 * The key is per-user and session-bound — it embeds user permissions as
 * HMAC-restricted tagFilters so we must scrape it from the frontend.
 */
async function getAlgoliaKey(): Promise<string> {
  // Cache for 25 minutes (keys typically last ~30 min)
  if (algoliaKeyCache && Date.now() - algoliaKeyCache.ts < 25 * 60_000) {
    return algoliaKeyCache.key;
  }

  const res = await authedFetch(`${BOOKFACE_BASE}/deals`, {
    headers: { Referer: `${BOOKFACE_BASE}/deals` },
  });
  if (!res.ok) throw new Error(`Failed to load deals page (${res.status})`);
  const body = await res.text();

  let key: string | undefined;

  // Try parsing as JSON (Rails may respond with JSON due to Accept header)
  try {
    const json = JSON.parse(body);
    key =
      deepGet(json, "algoliaApiKey") ??
      deepGet(json, "algolia_api_key") ??
      deepGet(json, "searchApiKey");
  } catch {
    // Not JSON — treat as HTML
  }

  // data-react-props attribute (HTML-entity encoded JSON)
  if (!key) {
    const m = body.match(/data-react-props="([^"]+)"/);
    if (m) {
      try {
        const decoded = m[1]
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, "&")
          .replace(/&#39;/g, "'");
        const props = JSON.parse(decoded);
        key =
          deepGet(props, "algoliaApiKey") ??
          deepGet(props, "algolia_api_key") ??
          deepGet(props, "searchApiKey");
      } catch {}
    }
  }

  // Key assignment in script tags
  if (!key) {
    const m = body.match(
      /["'](?:algolia[A-Za-z]*Key|apiKey|searchKey)["']\s*[=:]\s*["']([A-Za-z0-9+/=]{100,})["']/i
    );
    if (m) key = m[1];
  }

  // Last resort: very long base64 string (Algolia secured keys are 200+ chars)
  if (!key) {
    const m = body.match(/[A-Za-z0-9+/]{200,}={0,2}/);
    if (m) key = m[0];
  }

  if (!key)
    throw new Error(
      "Could not extract Algolia API key from deals page — page format may have changed"
    );

  algoliaKeyCache = { key, ts: Date.now() };
  return key;
}

function deepGet(obj: unknown, target: string): string | undefined {
  if (!obj || typeof obj !== "object") return;
  const rec = obj as Record<string, unknown>;
  if (target in rec && typeof rec[target] === "string")
    return rec[target] as string;
  for (const v of Object.values(rec)) {
    const found = deepGet(v, target);
    if (found) return found;
  }
}

server.tool(
  "search_deals",
  "Search YC Bookface deals by keyword and/or category tag. Returns matching deals with company name, description, tags, and deal ID for use with get_deal.",
  {
    query: z
      .string()
      .default("")
      .describe("Text search query (leave empty to browse all deals)"),
    tag: z
      .string()
      .optional()
      .describe(
        "Filter by deal category tag, e.g. 'Cloud Services', 'Developer Tools', 'Lead Generation', 'Design', 'Finance'"
      ),
    limit: z
      .number()
      .default(20)
      .describe("Max results to return (default 20, max 100)"),
  },
  async ({ query, tag, limit }) => {
    let algoliaKey: string;
    try {
      algoliaKey = await getAlgoliaKey();
    } catch (err) {
      return error(
        `Failed to get search credentials: ${err instanceof Error ? err.message : err}`
      );
    }

    const facetFilters = tag
      ? JSON.stringify([[`deal_tags:${tag}`]])
      : "";
    const params = [
      `query=${encodeURIComponent(query)}`,
      `hitsPerPage=${Math.min(limit, 100)}`,
      `page=0`,
      `facets=${encodeURIComponent(JSON.stringify(["deal_tags", "audience"]))}`,
      `maxValuesPerFacet=1000`,
      facetFilters
        ? `facetFilters=${encodeURIComponent(facetFilters)}`
        : "",
    ]
      .filter(Boolean)
      .join("&");

    const body = JSON.stringify({
      requests: [{ indexName: "Deal_production", params }],
      apiKey: algoliaKey,
    });

    const searchRes = await fetch(ALGOLIA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!searchRes.ok) {
      algoliaKeyCache = null; // key may have expired
      const text = await searchRes.text();
      return error(`Algolia search failed (${searchRes.status}): ${text.slice(0, 300)}`);
    }

    const data = (await searchRes.json()) as any;
    const result = data.results?.[0];
    const hits: any[] = result?.hits ?? [];
    const facets = result?.facets?.deal_tags ?? {};

    const deals = hits.map((h: any) => ({
      id: h.objectID ?? h.id,
      company: h.company_name ?? h.name,
      title: h.title,
      description: (h.description ?? "").slice(0, 300),
      tags: h.deal_tags,
      url: `${BOOKFACE_BASE}/deals/${h.objectID ?? h.id}`,
    }));

    const out: Record<string, unknown> = {
      total: result?.nbHits ?? deals.length,
      deals,
    };
    // Include available tags when browsing (no tag filter set)
    if (!tag && Object.keys(facets).length > 0) {
      out.available_tags = Object.entries(facets)
        .sort(([, a], [, b]) => (b as number) - (a as number))
        .slice(0, 30)
        .map(([name, count]) => `${name} (${count})`);
    }

    return ok(JSON.stringify(out, null, 2));
  }
);

// ── get_deal ──────────────────────────────────────────────────────────────

server.tool(
  "get_deal",
  "Get full details of a YC Bookface deal by ID, including redemption instructions and terms",
  {
    deal_id: z.number().describe("The numeric deal ID (e.g. 459)"),
  },
  async ({ deal_id }) => {
    const res = await authedFetch(`${BOOKFACE_BASE}/deals/${deal_id}.json`, {
      headers: { Referer: `${BOOKFACE_BASE}/deals/${deal_id}` },
    });
    if (!res.ok) return error(`Fetch deal failed (${res.status})`);
    const data = (await res.json()) as any;
    const d = data.deal ?? data;
    return ok(
      JSON.stringify(
        {
          id: d.id,
          company_name: d.company_name,
          title: d.title,
          description: d.description,
          redemption_notes: d.redemption_notes,
          url: d.url ?? d.website_url,
          tags: d.deal_tags ?? d.tags,
          audience: d.audience,
          logo_url: d.logo_url,
          active: d.active,
        },
        null,
        2
      )
    );
  }
);

// ── Helpers ─────────────────────────────────────────────────────────────────

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function error(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

// ── Start ───────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[yc-bookface] Server started.");
