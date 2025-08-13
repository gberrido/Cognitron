/**
 * @typedef {Object} ToolCall
 * @property {string} id
 * @property {string} type
 * @property {{ name: string, arguments: string }} function
 */

/**
 * @typedef {Object} ChatMessage
 * @property {'system'|'user'|'assistant'|'tool'} role
 * @property {string} content
 * @property {string} [tool_call_id]
 */

/**
 * @typedef {Object} Provider
 * @property {(payload: {messages: ChatMessage[], tools?: any[]})=>Promise<any>} complete
 * @property {(payload: {messages: ChatMessage[], tools?: any[]})=>AsyncIterable<any>} [stream]
 */

/**
 * @typedef {(args: any)=>Promise<any>} ToolHandler
 */

/**
 * @typedef {Object.<string, ToolHandler>} ToolRegistry
 */

/**
 * @typedef {Object} KernelHooks
 * @property {(ctx: {heartbeat: number, messages: ChatMessage[]})=>void} [onHeartbeatStart]
 * @property {(ctx: {heartbeat: number, messages: ChatMessage[], choice: any})=>void} [onHeartbeatEnd]
 * @property {(ctx: {id: string, name: string, args: any})=>void} [onToolCall]
 * @property {(ctx: {id: string, name: string, result: any})=>void} [onToolResult]
 * @property {(ctx: {finalMessage: string})=>void} [onPause]
 */
