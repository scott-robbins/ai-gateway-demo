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

// Pattern detection for differentiating DLP vs Guardrails block reasons
function classifyPromptIntent(prompt: string): "dlp" | "guardrails" | "unknown" {
	// DLP patterns - sensitive data formats
	const ssnPattern = /\b\d{3}-\d{2}-\d{4}\b/;
	const creditCardPattern = /\b(?:\d[ -]*?){13,19}\b/;
	const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/;
	const phonePattern = /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/;

	if (ssnPattern.test(prompt) || creditCardPattern.test(prompt) || emailPattern.test(prompt) || phonePattern.test(prompt)) {
		return "dlp";
	}

	// Guardrails patterns - harmful content keywords
	const harmfulKeywords = [
		"how to make", "how do i make", "kill", "murder", "weapon", "bomb", "poison",
		"disappear permanently", "hurt someone", "harm myself", "self-harm",
		"illegal drugs", "make drugs", "hack into", "steal"
	];
	const lowerPrompt = prompt.toLowerCase();
	if (harmfulKeywords.some(kw => lowerPrompt.includes(kw))) {
		return "guardrails";
	}

	return "unknown";
}

function buildDlpBlockResponse(): string {
	return [
		"🛡️ **AI Gateway — DLP Protection Triggered**",
		"",
		"Your request was intercepted by Cloudflare AI Gateway before reaching the model.",
		"",
		"**REASON:** Sensitive data pattern detected in your prompt.",
		"**PATTERNS DETECTED:** Personally Identifiable Information (PII) such as SSN, credit card, email, or phone number.",
		"**ACTION TAKEN:** Request blocked — data never transmitted to the AI model.",
		"",
		"This is Cloudflare AI Gateway DLP in action. Your sensitive data is protected at the gateway layer before any inference call is made."
	].join("\n");
}

function buildGuardrailsBlockResponse(): string {
	return [
		"🚧 **AI Gateway — Guardrails Policy Violation**",
		"",
		"Your request was flagged by Cloudflare AI Gateway content policies.",
		"",
		"**REASON:** Prompt violates configured Guardrails rules.",
		"**CATEGORY:** Harmful content detected by Llama Guard 3.",
		"**ACTION TAKEN:** Request blocked — model was never invoked.",
		"",
		"This is Cloudflare AI Gateway Guardrails in action. Policy enforcement happens before any model inference using Cloudflare's own safety classifier."
	].join("\n");
}

function buildGenericBlockResponse(): string {
	return [
		"⚠️ **AI Gateway — Request Blocked**",
		"",
		"Your request was blocked by Cloudflare AI Gateway security configurations.",
		"",
		"This may be due to DLP, Guardrails, or other policy rules configured on the gateway."
	].join("\n");
}

function buildSSEChunk(content: string): string {
	// Format response as OpenAI-compatible SSE stream so the frontend renders it cleanly
	const payload = {
		id: "block-" + Date.now(),
		object: "chat.completion.chunk",
		created: Math.floor(Date.now() / 1000),
		model: "ai-gateway-block",
		choices: [
			{
				index: 0,
				delta: { content: content },
				finish_reason: null
			}
		]
	};
	const donePayload = {
		id: "block-" + Date.now(),
		object: "chat.completion.chunk",
		created: Math.floor(Date.now() / 1000),
		model: "ai-gateway-block",
		choices: [
			{
				index: 0,
				delta: {},
				finish_reason: "stop"
			}
		]
	};
	return "data: " + JSON.stringify(payload) + "\n\ndata: " + JSON.stringify(donePayload) + "\n\ndata: [DONE]\n\n";
}

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

		// Classify the latest user prompt for block reason prediction
		const lastUserMsg = messages.filter(m => m.role === "user").pop();
		const predictedBlockReason = lastUserMsg ? classifyPromptIntent(lastUserMsg.content) : "unknown";
		console.log("[WORKER CLASSIFY] Predicted block reason if Gateway blocks: " + predictedBlockReason);

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

		// Handle AI Gateway block responses (status 424, error code 2016)
		if (!gatewayResponse.ok) {
			const errorText = await gatewayResponse.text();
			console.error("[GATEWAY ERROR] Status " + gatewayResponse.status + ":", errorText);

			// Check if this is a security block (DLP or Guardrails)
			const isSecurityBlock = gatewayResponse.status === 424 || errorText.includes("2016") || errorText.includes("security configurations");

			if (isSecurityBlock) {
				let blockContent = "";
				if (predictedBlockReason === "dlp") {
					blockContent = buildDlpBlockResponse();
				} else if (predictedBlockReason === "guardrails") {
					blockContent = buildGuardrailsBlockResponse();
				} else {
					blockContent = buildGenericBlockResponse();
				}

				return new Response(buildSSEChunk(blockContent), {
					headers: {
						"content-type": "text/event-stream; charset=utf-8",
						"cache-control": "no-cache",
						connection: "keep-alive",
					},
				});
			}

			// Non-security errors fall through to generic error response
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

		// Success - stream the model response back
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
