
export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: Role;
  content: string;
  tool_call_id?: string;
}

export interface ToolResult {
  success?: boolean;
  message?: string;
  // Additional fields are allowed
  [key: string]: any;
}

export type ToolRegistry = Record<string, (args: any) => Promise<ToolResult> | ToolResult>;

export interface FunctionToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: any; // JSON Schema object
  };
}

export type ToolDefinition = FunctionToolDefinition;

export interface ProviderCompleteInput {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
}

export interface ProviderResponseChoice {
  message?: any;
  delta?: any;
}

export interface ProviderResponse {
  choices: ProviderResponseChoice[];
}

export interface Provider {
  complete(input: ProviderCompleteInput): Promise<ProviderResponse>;
  stream?(input: ProviderCompleteInput): AsyncIterable<ProviderResponse>;
}

export interface KernelHooks {
  onHeartbeatStart?(info: { index: number; messages: ChatMessage[] }): void;
  onHeartbeatEnd?(info: { index: number; messages: ChatMessage[]; response?: any }): void;
  onToolCall?(info: { id: string; name: string; args: any }): void;
  onToolResult?(info: { id: string; name: string; result: any }): void;
  onPause?(message: string): void;
}

export interface RunTurnParams {
  messages: ChatMessage[];
  provider: Provider;
  tools?: ToolRegistry;
  toolDefinitions?: ToolDefinition[];
  maxHeartbeats?: number;
  hooks?: KernelHooks;
}

export interface RunTurnResult {
  finalMessage: string;
  messages: ChatMessage[];
}
