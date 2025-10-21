import { AnthropicProvider } from '../../ref/providers/anthropic.js';
import { assert } from '../util/assert.js';

try {
  // Test 1: Constructor and basic setup
  {
    const provider = new AnthropicProvider('test-key', 'claude-sonnet-4-20250514', 0.7, 2000);
    assert(provider.name() === 'anthropic', 'Provider name should be "anthropic"');
    assert(provider.model === 'claude-sonnet-4-20250514', 'Model should be set correctly');
    assert(provider.temperature === 0.7, 'Temperature should be 0.7');
    assert(provider.maxTokens === 2000, 'Max tokens should be 2000');
    // Note: provider.ok will be false if SDK is not installed, which is expected
    console.log(`   Provider.ok = ${provider.ok} (SDK ${provider.ok ? 'available' : 'not available'})`);
  }

  // Test 2: Convert OpenAI-style messages to Anthropic format
  {
    const provider = new AnthropicProvider('test-key', 'claude-sonnet-4-20250514', 0.7, 2000);

    const messages = [
      { role: 'system', content: 'You are a helpful assistant' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
      { role: 'user', content: 'How are you?' }
    ];

    const { system, messages: anthropicMessages } = provider.convertMessages(messages);
    assert(system === 'You are a helpful assistant', 'System message should be extracted');
    assert(anthropicMessages.length === 3, 'Should have 3 non-system messages');
    assert(anthropicMessages[0].role === 'user', 'First message should be user');
    assert(anthropicMessages[1].role === 'assistant', 'Second message should be assistant');
    assert(anthropicMessages[2].role === 'user', 'Third message should be user');
  }

  // Test 3: Convert multiple system messages
  {
    const provider = new AnthropicProvider('test-key', 'claude-sonnet-4-20250514', 0.7, 2000);

    const messages = [
      { role: 'system', content: 'System message 1' },
      { role: 'system', content: 'System message 2' },
      { role: 'user', content: 'Hello' }
    ];

    const { system, messages: anthropicMessages } = provider.convertMessages(messages);
    assert(system === 'System message 1\n\nSystem message 2', 'Multiple system messages should be joined');
    assert(anthropicMessages.length === 1, 'Should have 1 user message');
  }

  // Test 4: Convert OpenAI-style tools to Anthropic format
  {
    const provider = new AnthropicProvider('test-key', 'claude-sonnet-4-20250514', 0.7, 2000);

    const openAITools = [
      {
        type: 'function',
        function: {
          name: 'core_memory_append',
          description: 'Store a key-value pair',
          parameters: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              value: { type: 'string' }
            },
            required: ['key', 'value']
          }
        }
      }
    ];

    const anthropicTools = provider.convertTools(openAITools);
    assert(anthropicTools.length === 1, 'Should have 1 tool');
    assert(anthropicTools[0].name === 'core_memory_append', 'Tool name should match');
    assert(anthropicTools[0].description === 'Store a key-value pair', 'Tool description should match');
    assert(anthropicTools[0].input_schema.type === 'object', 'Input schema should be preserved');
  }

  // Test 5: Convert Anthropic response to OpenAI format
  {
    const provider = new AnthropicProvider('test-key', 'claude-sonnet-4-20250514', 0.7, 2000);

    const anthropicResponse = {
      id: 'msg_123',
      model: 'claude-sonnet-4-20250514',
      content: [
        { type: 'text', text: 'Hello! How can I help you?' }
      ],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 10,
        output_tokens: 20
      }
    };

    const openAIResponse = provider.convertResponse(anthropicResponse);
    assert(openAIResponse.id === 'msg_123', 'ID should be preserved');
    assert(openAIResponse.model === 'claude-sonnet-4-20250514', 'Model should be preserved');
    assert(openAIResponse.choices[0].message.role === 'assistant', 'Role should be assistant');
    assert(openAIResponse.choices[0].message.content === 'Hello! How can I help you?', 'Content should match');
    assert(openAIResponse.choices[0].finish_reason === 'end_turn', 'Finish reason should match');
    assert(openAIResponse.usage.prompt_tokens === 10, 'Input tokens should map to prompt_tokens');
    assert(openAIResponse.usage.completion_tokens === 20, 'Output tokens should map to completion_tokens');
    assert(openAIResponse.usage.total_tokens === 30, 'Total tokens should be sum');
  }

  // Test 6: Convert Anthropic response with tool calls
  {
    const provider = new AnthropicProvider('test-key', 'claude-sonnet-4-20250514', 0.7, 2000);

    const anthropicResponse = {
      id: 'msg_456',
      model: 'claude-sonnet-4-20250514',
      content: [
        { type: 'text', text: 'Let me store that information.' },
        {
          type: 'tool_use',
          id: 'tool_789',
          name: 'core_memory_append',
          input: { key: 'name', value: 'Alice' }
        }
      ],
      stop_reason: 'tool_use',
      usage: {
        input_tokens: 15,
        output_tokens: 25
      }
    };

    const openAIResponse = provider.convertResponse(anthropicResponse);
    assert(openAIResponse.choices[0].message.content === 'Let me store that information.', 'Text content should be extracted');
    assert(openAIResponse.choices[0].message.tool_calls.length === 1, 'Should have 1 tool call');
    assert(openAIResponse.choices[0].message.tool_calls[0].id === 'tool_789', 'Tool call ID should match');
    assert(openAIResponse.choices[0].message.tool_calls[0].function.name === 'core_memory_append', 'Tool name should match');
    const args = JSON.parse(openAIResponse.choices[0].message.tool_calls[0].function.arguments);
    assert(args.key === 'name', 'Tool argument key should match');
    assert(args.value === 'Alice', 'Tool argument value should match');
  }

  // Test 7: Retry logic (isRetryableError)
  {
    const provider = new AnthropicProvider('test-key', 'claude-sonnet-4-20250514', 0.7, 2000);

    assert(provider.isRetryableError({ code: 'ECONNRESET' }), 'ECONNRESET should be retryable');
    assert(provider.isRetryableError({ code: 'ETIMEDOUT' }), 'ETIMEDOUT should be retryable');
    assert(provider.isRetryableError({ status: 429 }), 'Status 429 should be retryable');
    assert(provider.isRetryableError({ status: 500 }), 'Status 500 should be retryable');
    assert(provider.isRetryableError({ status: 503 }), 'Status 503 should be retryable');
    assert(!provider.isRetryableError({ status: 400 }), 'Status 400 should not be retryable');
    assert(!provider.isRetryableError({ status: 404 }), 'Status 404 should not be retryable');
  }

  // Test 8: Tool result message conversion
  {
    const provider = new AnthropicProvider('test-key', 'claude-sonnet-4-20250514', 0.7, 2000);

    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'tool', tool_call_id: 'tool_123', content: '{"success": true}' }
    ];

    const { system, messages: anthropicMessages } = provider.convertMessages(messages);
    assert(anthropicMessages.length === 2, 'Should have 2 messages');
    assert(anthropicMessages[0].role === 'user', 'First message should be user');
    assert(anthropicMessages[1].role === 'user', 'Tool result should be user role in Anthropic');
    assert(anthropicMessages[1].content[0].type === 'tool_result', 'Should have tool_result type');
    assert(anthropicMessages[1].content[0].tool_use_id === 'tool_123', 'Tool use ID should match');
    assert(anthropicMessages[1].content[0].content === '{"success": true}', 'Tool result content should match');
  }

  console.log('OK test_anthropic_provider');
} catch (err) {
  console.error('FAIL test_anthropic_provider:', err.message);
  console.error(err.stack);
  process.exit(1);
}
