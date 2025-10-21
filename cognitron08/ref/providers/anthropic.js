let Anthropic;
try {
  // Try to import @anthropic-ai/sdk if available
  Anthropic = (await import('@anthropic-ai/sdk')).default;
} catch {
  // SDK not available - provider will not be usable but won't crash
  Anthropic = null;
}

export class AnthropicProvider {
  constructor(apiKey, model, temperature, maxTokens) {
    this.apiKey = apiKey;
    this.client = (apiKey && Anthropic) ? new Anthropic({ apiKey }) : null;
    this.model = model;
    this.temperature = temperature;
    this.maxTokens = maxTokens;
    this.maxRetries = 3;
    this.baseDelay = 1000; // 1 second
  }

  get ok() { return !!this.client; }
  name() { return 'anthropic'; }

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
        console.warn(`Anthropic API call failed (attempt ${attempt + 1}/${retries}): ${error.message}`);

        // Wait before retrying
        await this.exponentialBackoff(attempt);
      }
    }

    throw lastError;
  }

  /**
   * Convert OpenAI-style messages to Anthropic format
   */
  convertMessages(messages) {
    const systemMessages = [];
    const conversationMessages = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemMessages.push(msg.content);
      } else if (msg.role === 'user' || msg.role === 'assistant') {
        conversationMessages.push({
          role: msg.role,
          content: msg.content || ''
        });
      } else if (msg.role === 'tool') {
        // Anthropic uses tool_result instead of tool role
        conversationMessages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.tool_call_id || 'unknown',
              content: msg.content || ''
            }
          ]
        });
      }
    }

    return {
      system: systemMessages.join('\n\n'),
      messages: conversationMessages
    };
  }

  /**
   * Convert OpenAI-style tools to Anthropic format
   */
  convertTools(tools) {
    if (!tools || !tools.length) return null;

    return tools.map(tool => ({
      name: tool.function.name,
      description: tool.function.description || '',
      input_schema: tool.function.parameters || { type: 'object', properties: {} }
    }));
  }

  /**
   * Convert Anthropic response to OpenAI format
   */
  convertResponse(response) {
    const message = {
      role: 'assistant',
      content: ''
    };

    // Extract text content and tool calls
    const textParts = [];
    const toolCalls = [];

    for (const block of response.content || []) {
      if (block.type === 'text') {
        textParts.push(block.text);
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input)
          }
        });
      }
    }

    message.content = textParts.join('\n');

    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls;
    }

    return {
      id: response.id,
      object: 'chat.completion',
      created: Date.now(),
      model: response.model,
      choices: [
        {
          index: 0,
          message,
          finish_reason: response.stop_reason
        }
      ],
      usage: {
        prompt_tokens: response.usage?.input_tokens || 0,
        completion_tokens: response.usage?.output_tokens || 0,
        total_tokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0)
      }
    };
  }

  async complete(payload) {
    const { system, messages } = this.convertMessages(payload.messages || []);
    const tools = this.convertTools(payload.tools);

    const body = {
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      messages
    };

    if (system) {
      body.system = system;
    }

    if (tools && tools.length > 0) {
      body.tools = tools;
    }

    const response = await this.withRetry(() => this.client.messages.create(body));
    return this.convertResponse(response);
  }

  async stream(payload) {
    const { system, messages } = this.convertMessages(payload.messages || []);
    const tools = this.convertTools(payload.tools);

    const body = {
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      messages,
      stream: true
    };

    if (system) {
      body.system = system;
    }

    if (tools && tools.length > 0) {
      body.tools = tools;
    }

    // Return stream wrapper that converts Anthropic events to OpenAI format
    const anthropicStream = await this.withRetry(() => this.client.messages.create(body));

    // Create async iterator wrapper
    const streamWrapper = {
      [Symbol.asyncIterator]: async function* () {
        let currentMessage = {
          id: null,
          role: 'assistant',
          content: '',
          tool_calls: []
        };
        let toolCallIndex = 0;

        for await (const event of anthropicStream) {
          if (event.type === 'message_start') {
            currentMessage.id = event.message.id;
          } else if (event.type === 'content_block_start') {
            if (event.content_block.type === 'tool_use') {
              currentMessage.tool_calls.push({
                index: toolCallIndex++,
                id: event.content_block.id,
                type: 'function',
                function: {
                  name: event.content_block.name,
                  arguments: ''
                }
              });
            }
          } else if (event.type === 'content_block_delta') {
            if (event.delta.type === 'text_delta') {
              // Text content
              yield {
                choices: [{
                  index: 0,
                  delta: { content: event.delta.text },
                  finish_reason: null
                }]
              };
            } else if (event.delta.type === 'input_json_delta') {
              // Tool call arguments
              const lastToolCall = currentMessage.tool_calls[currentMessage.tool_calls.length - 1];
              if (lastToolCall) {
                lastToolCall.function.arguments += event.delta.partial_json;
                yield {
                  choices: [{
                    index: 0,
                    delta: {
                      tool_calls: [{
                        index: lastToolCall.index,
                        function: { arguments: event.delta.partial_json }
                      }]
                    },
                    finish_reason: null
                  }]
                };
              }
            }
          } else if (event.type === 'message_delta') {
            if (event.delta.stop_reason) {
              yield {
                choices: [{
                  index: 0,
                  delta: {},
                  finish_reason: event.delta.stop_reason
                }]
              };
            }
          }
        }
      }
    };

    return streamWrapper;
  }
}
