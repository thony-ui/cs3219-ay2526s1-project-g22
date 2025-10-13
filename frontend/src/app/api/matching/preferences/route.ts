// app/api/matching/preferences/[userId]/route.ts
import { NextRequest } from "next/server";

const BASE_URL = "http://localhost:6002/api/matching/preferences";

async function proxy(
    req: NextRequest,
    userId: string,
    method: "GET" | "POST" | "PUT" | "DELETE"
) {
    const targetUrl = `${BASE_URL}/${encodeURIComponent(userId)}`;

    // Forward headers except for ones that can cause hop-by-hop issues
    const headers = new Headers();
    req.headers.forEach((value, key) => {
        if (
            ![
                "connection",
                "keep-alive",
                "transfer-encoding",
                "proxy-authenticate",
                "proxy-authorization",
                "te",
                "trailers",
                "upgrade",
                "host",
            ].includes(key.toLowerCase())
        ) {
            headers.set(key, value);
        }
    });

    const init: RequestInit = {
        method,
        headers,
        // Only include body for methods that can have one
        body: method === "GET" || method === "DELETE" ? undefined : await req.text(),
        redirect: "manual",
    };

    try {
        const res = await fetch(targetUrl, init);

        // Build a Response with the same status and body, and pass through content-type
        const resHeaders = new Headers();
        res.headers.forEach((value, key) => {
            if (!["content-encoding", "content-length"].includes(key.toLowerCase())) {
                resHeaders.set(key, value);
            }
        });

        const body = await res.arrayBuffer();
        return new Response(body, {
            status: res.status,
            statusText: res.statusText,
            headers: resHeaders,
        });
    } catch (err) {
        console.error("Proxy error:", err);
        return new Response(JSON.stringify({ error: "Upstream fetch failed" }), {
            status: 502,
            headers: { "content-type": "application/json" },
        });
    }
}

export async function GET(
    req: NextRequest,
    context: { params: { userId: string } }
) {
    return proxy(req, context.params.userId, "GET");
}

export async function POST(
    req: NextRequest,
    context: { params: { userId: string } }
) {
    return proxy(req, context.params.userId, "POST");
}

export async function PUT(
    req: NextRequest,
    context: { params: { userId: string } }
) {
    return proxy(req, context.params.userId, "PUT");
}

export async function DELETE(
    req: NextRequest,
    context: { params: { userId: string } }
) {
    return proxy(req, context.params.userId, "DELETE");
}