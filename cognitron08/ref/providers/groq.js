import { Groq } from 'groq-sdk';

export class GroqProvider {
  constructor(apiKey, model, temperature, maxTokens) {
    this.client = apiKey ? new Groq({ apiKey }) : null;
    this.model = model;
    this.temperature = temperature;
    this.maxTokens = maxTokens;
    this.maxRetries = 3;
    this.baseDelay = 1000; // 1 second
  }

  get ok() { return !!this.client; }
  name() { return 'groq'; }

  /**
   * Check if an error is retryable (network errors, rate limits, server errors)
   */
  isRetryableError(error) {
    if (!error) return false;

    // Network errors
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
      return true;
    }

    // HTTP status codes that should be retried
    const status = error.status || error.statusCode;
    if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
      return true;
    }

    return false;
  }

  /**
   * Wait with exponential backoff
   */
  async exponentialBackoff(attempt) {
    const delay = this.baseDelay * Math.pow(2, attempt);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Execute a function with retry logic
   */
  async withRetry(fn, retries = this.maxRetries) {
    let lastError;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        // Don't retry if this is the last attempt or error is not retryable
        if (attempt === retries - 1 || !this.isRetryableError(error)) {
          throw error;
        }

        // Log retry attempt
        console.warn(`Groq API call failed (attempt ${attempt + 1}/${retries}): ${error.message}`);

        // Wait before retrying
        await this.exponentialBackoff(attempt);
      }
    }

    throw lastError;
  }

  async complete(payload) {
    const body = { model: this.model, temperature: this.temperature, max_tokens: this.maxTokens, ...payload };
    if (payload?.tools?.length) body.tool_choice = 'auto';

    return this.withRetry(() => this.client.chat.completions.create(body));
  }

  async stream(payload) {
    const body = { model: this.model, temperature: this.temperature, max_tokens: this.maxTokens, stream: true, ...payload };
    if (payload?.tools?.length) body.tool_choice = 'auto';

    // Note: Streaming is harder to retry mid-stream, so we only retry the initial connection
    return this.withRetry(() => this.client.chat.completions.create(body));
  }
}
