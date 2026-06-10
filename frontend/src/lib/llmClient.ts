import Anthropic from "@anthropic-ai/sdk";

/**
 * DeepSeek via its Anthropic-compatible endpoint.
 *
 * Lets us keep the @anthropic-ai/sdk (messages.create, error classes, response
 * parsing, retry logic) unchanged and only swap the backend — billing is then
 * visible in the user's own DeepSeek console.
 *
 * Lazy singleton so a missing key doesn't throw at build/import time; a real
 * request without DEEPSEEK_API_KEY surfaces as a normal (caught) auth error.
 */
let _client: Anthropic | null = null;

export function getLLM(): Anthropic {
  if (!_client) {
    _client = new Anthropic({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: "https://api.deepseek.com/anthropic",
    });
  }
  return _client;
}
