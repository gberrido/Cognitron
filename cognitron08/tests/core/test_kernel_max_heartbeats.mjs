import { runTurn } from '../../core/runTurn.js';
import { assertEq } from '../util/assert.js';

class SilentProvider {
  constructor(times=3){ this.left=times; }
  async complete(){ this.left--; return { choices: [{ message: { content: '' } }] }; }
}

const tools = {};
const messages = [{ role: 'system', content: 'You are minimal.' }, { role: 'user', content: 'just idle' }];
const provider = new SilentProvider(5);
const res = await runTurn({ messages, provider, tools, toolDefinitions: [], maxHeartbeats: 2 });
assertEq(res.finalMessage, 'Ok.', 'fallback final message when no pause');
console.log('OK kernel_max_heartbeats');
