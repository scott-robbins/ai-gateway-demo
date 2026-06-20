/**
 * AI Gateway Demo Bot
 *
 * A demo chatbot designed to showcase Cloudflare AI Gateway capabilities:
 * - DLP custom block responses
 * - Guardrails custom block responses
 * - Dynamic Routing provider failover
 * - Load Balancing across models
 * - Rate Limiting on cost/tokens
 *
 * @license MIT
 */
import { Env, ChatMessage } from "./types";

const AI_GATEWAY_ACCOUNT_ID = "3746ba19913534b7653b8af6a1299286";
const AI_GATEWAY_NAME = "ai-gateway-demo";
const AI_GATEWAY_ENDPOINT = "https://gateway.ai.cloudflare.com/v1/" + AI_GATEWAY_ACCOUNT_ID + "/" + AI_GATEWAY_NAME + "/compat/chat/completions";

const DEFAULT_MODEL = "workers-ai/@cf/meta/llama-3.1-8b-instruct-fp8";

const SYSTEM_PROMPT =
	"You are the AI Gateway Demo Bot. You are running on Cloudflare Workers and routing all requests through Cloudflare AI Gateway. You demonstrate AI Gateway capabilities including DLP, Guardrails, Dynamic Routing, Load Balancing, and Rate Limiting. Be helpful, concise, and friendly.";

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
			return env.ASSETS.fetch(request);
		}

		if (url.pathname === "/api/chat") {
			if (request.method === "POST") {
				return handleChatRequest(request, env);
			}
			return new Response("Method not allowed", { status: 405 });
		}

		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;

async function handleChatRequest(
	request: Request,
	env: Env,
): Promise<Response> {
	try {
		const { messages = [] } = (await request.json()) as {
			messages: ChatMessage[];
		};

		if (!messages.some((msg) => msg.role === "system")) {
			messages.unshift({ role: "system", content: SYSTEM_PROMPT });
		}

		const requestBody = {
			model: DEFAULT_MODEL,
			messages,
			max_tokens: 1024,
			stream: true,
		};

		const gatewayResponse = await fetch(AI_GATEWAY_ENDPOINT, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Authorization": "Bearer " + (env.CF_API_TOKEN || ""),
			},
			body: JSON.stringify(requestBody),
		});

		if (!gatewayResponse.ok) {
			const errorText = await gatewayResponse.text();
			console.error("[GATEWAY ERROR] Status " + gatewayResponse.status + ":", errorText);
			return new Response(
				JSON.stringify({
					error: "AI Gateway request failed",
					status: gatewayResponse.status,
					detail: errorText,
				}),
				{
					status: gatewayResponse.status,
					headers: { "content-type": "application/json" },
				},
			);
		}

		return new Response(gatewayResponse.body, {
			headers: {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache",
				connection: "keep-alive",
			},
		});
	} catch (error) {
		console.error("Error processing chat request:", error);
		return new Response(
			JSON.stringify({ error: "Failed to process request" }),
			{
				status: 500,
				headers: { "content-type": "application/json" },
			},
		);
	}
}
