/**
 * Type definitions for the LLM chat application.
 */

export interface Env {
    /**
     * Binding for the Workers AI API.
     */
    AI: Ai;

    /**
     * Binding for static assets.
     */
    ASSETS: { fetch: (request: Request) => Promise<Response> };

    /**
     * Cloudflare API token for AI Gateway authentication.
     */
    CF_API_TOKEN: string;

    /**
     * Service Token Client ID for authenticating the Worker to Access-protected AI Gateway custom domain.
     */
    CF_ACCESS_CLIENT_ID: string;

    /**
     * Service Token Client Secret for authenticating the Worker to Access-protected AI Gateway custom domain.
     */
    CF_ACCESS_CLIENT_SECRET: string;
}
	