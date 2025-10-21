import TogetherWrapper from 'together-ai';

export class TogetherProvider {
  constructor(apiKey, model, temperature, maxTokens) {
    const Together = (TogetherWrapper && TogetherWrapper.default) ? TogetherWrapper.default : TogetherWrapper;
    this.client = apiKey ? new Together({ apiKey, timeout: 60000 }) : null;
    this.model = model;
    this.temperature = temperature;
    this.maxTokens = maxTokens;
    this.apiKey = apiKey;
    this.maxRetries = 3;
    this.baseDelay = 1000; // 1 second
  }

  get ok() { return !!this.client; }
  name() { return 'together'; }

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

    // Check error message for common retryable errors
    const message = error.message || '';
    if (message.includes('HTTP 429') || message.includes('HTTP 500') ||
        message.includes('HTTP 502') || message.includes('HTTP 503') || message.includes('HTTP 504')) {
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
        console.warn(`Together API call failed (attempt ${attempt + 1}/${retries}): ${error.message}`);

        // Wait before retrying
        await this.exponentialBackoff(attempt);
      }
    }

    throw lastError;
  }
  async complete(payload) {
    const body = { model: this.model, temperature: this.temperature, max_tokens: this.maxTokens, ...payload };

    return this.withRetry(async () => {
      if (this.client?.chat?.completions?.create) {
        if (payload?.tools?.length) body.tool_choice = 'auto';
        return this.client.chat.completions.create(body);
      }

      // Fallback to HTTP fetch
      const res = await fetch('https://api.together.xyz/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
        body: JSON.stringify({ ...body, stream: false })
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        throw new Error(`Together HTTP ${res.status}: ${errorText}`);
      }

      return await res.json();
    });
  }
  async stream(payload) {
    const body = { model: this.model, temperature: this.temperature, max_tokens: this.maxTokens, ...payload };

    // Note: Streaming is harder to retry mid-stream, so we only retry the initial connection
    return this.withRetry(async () => {
      if (this.client?.chat?.completions?.create) {
        if (payload?.tools?.length) body.tool_choice = 'auto';
        return this.client.chat.completions.create({ ...body, stream: true });
      }

      // Fallback to HTTP fetch with streaming
      const res = await fetch('https://api.together.xyz/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
        body: JSON.stringify({ ...body, stream: true })
      });

      if (!res.ok || !res.body) {
        const errorText = await res.text().catch(() => '');
        throw new Error(`Together HTTP ${res.status}: ${errorText}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      async function* iter() {
        let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split(/\r?\n/);
          buf = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') return;

            try {
              const json = JSON.parse(data);
              const delta = json.choices?.[0]?.delta || {};
              yield { choices: [{ delta }] };
            } catch (err) {
              // Skip malformed JSON chunks
              continue;
            }
          }
        }

        // Process any remaining buffered data
        if (buf) {
          try {
            const json = JSON.parse(buf.replace(/^data:\s*/, ''));
            const delta = json.choices?.[0]?.delta || {};
            yield { choices: [{ delta }] };
          } catch (err) {
            // Skip if final buffer is malformed
          }
        }
      }

      return iter();
    });
  }
}
