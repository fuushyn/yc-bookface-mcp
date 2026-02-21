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

// ── send_message ────────────────────────────────────────────────────────────

server.tool(
  "send_message",
  "Send a message to an existing YC Bookface agent chat thread",
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
    const messages: unknown[] = Array.isArray(data)
      ? data
      : (data as any).chat_messages ?? data;
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
