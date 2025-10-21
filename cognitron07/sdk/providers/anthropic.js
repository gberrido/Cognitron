import Anthropic from '@anthropic-ai/sdk';

export class AnthropicProvider {
  constructor(apiKey, model, temperature, maxTokens) {
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
    this.model = model;
    this.temperature = temperature;
    this.maxTokens = maxTokens;
  }
  get ok() { return !!this.client; }
  name() { return 'anthropic'; }

  async complete(payload) {
    // Convert OpenAI-style format to Anthropic format
    const messages = this._convertMessages(payload.messages);
    const systemMessage = payload.messages?.find(m => m.role === 'system')?.content || '';

    const body = {
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      messages: messages.filter(m => m.role !== 'system'),
    };

    if (systemMessage) {
      body.system = systemMessage;
    }

    if (payload?.tools?.length) {
      body.tools = this._convertTools(payload.tools);
    }

    const response = await this.client.messages.create(body);

    // Convert Anthropic response to OpenAI-style format
    return this._convertResponse(response);
  }

  async stream(payload) {
    // Convert OpenAI-style format to Anthropic format
    const messages = this._convertMessages(payload.messages);
    const systemMessage = payload.messages?.find(m => m.role === 'system')?.content || '';

    const body = {
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      messages: messages.filter(m => m.role !== 'system'),
      stream: true,
    };

    if (systemMessage) {
      body.system = systemMessage;
    }

    if (payload?.tools?.length) {
      body.tools = this._convertTools(payload.tools);
    }

    const stream = await this.client.messages.create(body);

    // Convert Anthropic stream to OpenAI-style format
    return this._convertStream(stream);
  }

  _convertMessages(messages) {
    if (!messages) return [];
    return messages.map(msg => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content
    }));
  }

  _convertTools(tools) {
    // Convert OpenAI function format to Anthropic tool format
    return tools.map(tool => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters
    }));
  }

  _convertResponse(response) {
    // Convert Anthropic response to OpenAI-style format
    const result = {
      id: response.id,
      model: response.model,
      choices: [{
        message: {
          role: 'assistant',
          content: ''
        }
      }]
    };

    // Handle content blocks
    if (response.content) {
      for (const block of response.content) {
        if (block.type === 'text') {
          result.choices[0].message.content += block.text;
        } else if (block.type === 'tool_use') {
          if (!result.choices[0].message.tool_calls) {
            result.choices[0].message.tool_calls = [];
          }
          result.choices[0].message.tool_calls.push({
            id: block.id,
            type: 'function',
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input)
            }
          });
        }
      }
    }

    return result;
  }

  async* _convertStream(stream) {
    let currentContent = '';
    let currentToolCalls = [];

    for await (const chunk of stream) {
      const delta = {};

      if (chunk.type === 'content_block_start') {
        if (chunk.content_block?.type === 'text') {
          delta.content = '';
        } else if (chunk.content_block?.type === 'tool_use') {
          delta.tool_calls = [{
            id: chunk.content_block.id,
            type: 'function',
            function: {
              name: chunk.content_block.name,
              arguments: ''
            }
          }];
        }
      } else if (chunk.type === 'content_block_delta') {
        if (chunk.delta?.type === 'text_delta') {
          delta.content = chunk.delta.text;
        } else if (chunk.delta?.type === 'input_json_delta') {
          delta.tool_calls = [{
            function: {
              arguments: chunk.delta.partial_json
            }
          }];
        }
      }

      if (Object.keys(delta).length > 0) {
        yield {
          choices: [{
            delta: delta
          }]
        };
      }
    }
  }
}
