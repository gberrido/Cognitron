import { countTokens, countMessageTokens, countTokensSimple, getTokenStats, exceedsLimit } from '../../ref/utils/tokenizer.js';
import { assert } from '../util/assert.js';

try {
  // Test 1: Basic token counting
  {
    const text = 'Hello, world!';
    const tokens = countTokens(text);
    assert(tokens > 0, 'Should count tokens for simple text');
    assert(tokens <= 5, 'Simple greeting should be ~2-3 tokens');
  }

  // Test 2: Empty and null inputs
  {
    assert(countTokens('') === 0, 'Empty string should be 0 tokens');
    assert(countTokens(null) === 0, 'Null should be 0 tokens');
    assert(countTokens(undefined) === 0, 'Undefined should be 0 tokens');
    assert(countTokens('   ') === 0, 'Whitespace-only should be 0 tokens');
  }

  // Test 3: Number handling
  {
    const numbers = '12345';
    const tokens = countTokens(numbers);
    assert(tokens >= 1 && tokens <= 3, `Numbers should be 1-3 tokens, got ${tokens}`);

    const longNumber = '123456789012345';
    const longTokens = countTokens(longNumber);
    assert(longTokens >= 3, `Long number should be multiple tokens, got ${longTokens}`);
  }

  // Test 4: Punctuation
  {
    const punct = 'Hello! How are you? I\'m fine, thanks.';
    const tokens = countTokens(punct);
    assert(tokens >= 8, `Sentence with punctuation should have multiple tokens, got ${tokens}`);
  }

  // Test 5: Long words
  {
    const shortWord = 'cat';
    const shortTokens = countTokens(shortWord);
    assert(shortTokens === 1, `Short word should be 1 token, got ${shortTokens}`);

    const mediumWord = 'elephant';
    const mediumTokens = countTokens(mediumWord);
    assert(mediumTokens >= 1 && mediumTokens <= 2, `Medium word should be 1-2 tokens, got ${mediumTokens}`);

    const longWord = 'antidisestablishmentarianism';
    const longTokens = countTokens(longWord);
    assert(longTokens >= 3, `Very long word should be multiple tokens, got ${longTokens}`);
  }

  // Test 6: Comparison with simple tokenizer
  {
    const text = 'The quick brown fox jumps over the lazy dog';
    const improved = countTokens(text);
    const simple = countTokensSimple(text);

    // Both should be positive
    assert(improved > 0, 'Improved tokenizer should count > 0');
    assert(simple > 0, 'Simple tokenizer should count > 0');

    // They should be in the same ballpark (within 50% of each other)
    const ratio = improved / simple;
    assert(ratio > 0.5 && ratio < 1.5, `Ratio ${ratio.toFixed(2)} should be between 0.5 and 1.5`);

    // Test with simple words - should be reasonable
    const simpleWords = 'cat dog';
    const simpleCount = countTokens(simpleWords);
    assert(simpleCount >= 2 && simpleCount <= 4, `Simple words should be 2-4 tokens, got ${simpleCount}`);
  }

  // Test 7: Message token counting
  {
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
      { role: 'user', content: 'How are you?' }
    ];

    const totalTokens = countMessageTokens(messages);
    assert(totalTokens > 0, 'Should count tokens for messages');

    // Should include overhead (4 tokens per message)
    const contentTokens = messages.reduce((sum, m) => sum + countTokens(m.content), 0);
    const overhead = messages.length * 4;
    assert(totalTokens >= contentTokens, 'Total should include overhead');
  }

  // Test 8: Tool call overhead
  {
    const normalMessage = [{ role: 'user', content: 'test' }];
    const toolMessage = [{ role: 'tool', content: 'test', tool_call_id: 'call_123' }];

    const normalTokens = countMessageTokens(normalMessage);
    const toolTokens = countMessageTokens(toolMessage);

    assert(toolTokens > normalTokens, 'Tool messages should have additional overhead');
  }

  // Test 9: Token statistics
  {
    const text = 'The quick brown fox jumps over the lazy dog';
    const stats = getTokenStats(text);

    assert(stats.tokens > 0, 'Stats should include token count');
    assert(stats.chars === text.length, `Stats chars (${stats.chars}) should match text length (${text.length})`);
    assert(stats.words === 9, `Should count 9 words, got ${stats.words}`);
    assert(stats.avgTokensPerWord > 0, 'Should calculate average tokens per word');
    assert(stats.estimatedAccuracy === '±15%', 'Should include accuracy estimate');
  }

  // Test 10: Limit checking
  {
    const shortText = 'Hello';
    const longText = 'word '.repeat(1000); // ~1000 words

    assert(!exceedsLimit(shortText, 1000), 'Short text should not exceed high limit');
    assert(exceedsLimit(longText, 100), 'Long text should exceed low limit');

    // Test with safety margin
    const marginText = 'word '.repeat(92); // ~92 words = ~92 tokens
    assert(exceedsLimit(marginText, 100, 0.1), 'Should exceed with 10% safety margin (limit becomes 90)');
    assert(!exceedsLimit(marginText, 100, 0), 'Should not exceed 100 without margin');
  }

  // Test 11: Unicode and special characters
  {
    const unicode = 'Hello 世界 🌍 émoji';
    const tokens = countTokens(unicode);
    assert(tokens > 0, 'Should handle unicode characters');

    const emoji = '😀 😃 😄 😁';
    const emojiTokens = countTokens(emoji);
    assert(emojiTokens > 0, 'Should handle emoji');
  }

  // Test 12: Code-like text
  {
    const code = 'function hello() { return "world"; }';
    const tokens = countTokens(code);
    assert(tokens > 5, 'Should count tokens in code');

    // Code typically has more tokens due to punctuation
    const words = code.match(/\w+/g).length;
    assert(tokens > words, 'Code should have more tokens than words due to punctuation');
  }

  // Test 13: Very long text performance
  {
    const longText = 'Lorem ipsum dolor sit amet, '.repeat(10000); // ~50KB
    const start = Date.now();
    const tokens = countTokens(longText);
    const duration = Date.now() - start;

    assert(tokens > 0, 'Should handle very long text');
    assert(duration < 1000, `Should count tokens quickly (took ${duration}ms)`);
  }

  // Test 14: Consistency
  {
    const text = 'The same text should always produce the same count';

    const count1 = countTokens(text);
    const count2 = countTokens(text);
    const count3 = countTokens(text);

    assert(count1 === count2, 'Should be consistent across calls');
    assert(count2 === count3, 'Should be consistent across calls');
  }

  // Test 15: Real-world conversation example
  {
    const conversation = [
      { role: 'system', content: 'You are a helpful assistant with persistent memory.' },
      { role: 'user', content: 'Hello, my name is Alice and I live in San Francisco.' },
      { role: 'assistant', content: 'Nice to meet you, Alice! I\'ll remember that you live in San Francisco.' },
      { role: 'user', content: 'What\'s my name?' },
      { role: 'assistant', content: 'Your name is Alice!' }
    ];

    const totalTokens = countMessageTokens(conversation);

    // Estimate: ~50-80 tokens for this conversation
    assert(totalTokens >= 40 && totalTokens <= 150, `Real conversation should be 40-150 tokens, got ${totalTokens}`);
  }

  console.log('OK test_tokenizer');
} catch (err) {
  console.error('FAIL test_tokenizer:', err.message);
  console.error(err.stack);
  process.exit(1);
}
