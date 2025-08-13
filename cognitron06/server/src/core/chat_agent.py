#\!/usr/bin/env python3
"""
MemGPT Chat Agent for Cognitron06 Server
Python port with async support, memory integration, and multi-model support
"""

import json
import logging
from typing import Dict, List, Any, Optional, AsyncGenerator
from groq import AsyncGroq
from .memory_system import MemGPTMemorySystem
from .model_config import ModelConfigManager, ModelConfig

logger = logging.getLogger(__name__)


class ChatAgent:
    """MemGPT-enhanced chat agent with memory management and multi-model support"""
    
    def __init__(self, api_key: str, model: str = None, memory_system: MemGPTMemorySystem = None):
        # Initialize model configuration
        if model is None:
            model = ModelConfigManager.DEFAULT_MODEL
        
        if not ModelConfigManager.is_valid_model(model):
            logger.warning(f"Invalid model '{model}', falling back to default")
            model = ModelConfigManager.DEFAULT_MODEL
        
        self.current_model = model
        self.model_config = ModelConfigManager.get_model_config(model)
        
        # Legacy config compatibility
        self.config = {
            "model": model,
            "temperature": self.model_config.default_params.get("temperature", 0.7),
            "max_tokens": self.model_config.default_params.get("max_tokens", 4096),
            "reasoning_level": "medium"
        }
        
        # Initialize Groq client and memory system
        self.api_key = api_key
        self.memory_system = memory_system
        self.groq = AsyncGroq(api_key=api_key)
        
        # Tool definitions for MemGPT memory management
        self.tools = [
            {
                "type": "function",
                "function": {
                    "name": "core_memory_append",
                    "description": "Append to the working context (core memory). Use this to remember key facts about the user, preferences, or important information that should persist across conversations.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "key": {
                                "type": "string",
                                "description": "A concise key/label for this memory (e.g., 'user_name', 'favorite_food', 'birthday')"
                            },
                            "value": {
                                "type": "string",
                                "description": "The information to store in core memory"
                            }
                        },
                        "required": ["key", "value"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "core_memory_replace",
                    "description": "Replace existing working context entry. Use when you need to update or correct existing memory.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "key": {
                                "type": "string",
                                "description": "The key of the memory entry to replace"
                            },
                            "new_value": {
                                "type": "string",
                                "description": "The new value to store"
                            }
                        },
                        "required": ["key", "new_value"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "conversation_search",
                    "description": "Search through conversation history to find relevant past interactions. Use this when you need to reference previous conversations.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {
                                "type": "string",
                                "description": "Search query to find relevant conversations"
                            },
                            "count": {
                                "type": "integer",
                                "description": "Maximum number of results to return",
                                "default": 5
                            }
                        },
                        "required": ["query"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "archival_memory_insert",
                    "description": "Insert important information into long-term archival storage. Use for information that doesn't belong in working context but should be preserved long-term.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "key": {
                                "type": "string",
                                "description": "A unique key for this archival entry"
                            },
                            "content": {
                                "type": "string",
                                "description": "The information to store in archival memory"
                            }
                        },
                        "required": ["key", "content"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "archival_memory_search",
                    "description": "Search through archival storage for relevant information. Use when you need to retrieve long-term stored information.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {
                                "type": "string",
                                "description": "Search query for archival memory"
                            },
                            "count": {
                                "type": "integer",
                                "description": "Maximum number of results to return",
                                "default": 5
                            }
                        },
                        "required": ["query"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "get_memory_status",
                    "description": "Get current memory usage statistics and status information.",
                    "parameters": {
                        "type": "object",
                        "properties": {},
                        "required": []
                    }
                }
            }
        ]
    
    def get_current_model(self) -> str:
        """Get the currently active model"""
        return self.current_model
    
    def get_model_info(self) -> Dict[str, Any]:
        """Get information about the current model"""
        return ModelConfigManager.get_model_summary(self.current_model)
    
    def switch_model(self, new_model: str) -> bool:
        """Switch to a different model"""
        if not ModelConfigManager.is_valid_model(new_model):
            logger.error(f"Invalid model: {new_model}")
            return False
        
        logger.info(f"Switching model from {self.current_model} to {new_model}")
        self.current_model = new_model
        self.model_config = ModelConfigManager.get_model_config(new_model)
        return True
    
    def list_available_models(self) -> Dict[str, Dict[str, Any]]:
        """Get list of all available models with their information"""
        models = {}
        for model_name in ModelConfigManager.get_model_names():
            models[model_name] = ModelConfigManager.get_model_summary(model_name)
        return models

    def build_messages(self, user_id: str, user_message: Optional[str] = None, include_context: bool = True) -> List[Dict[str, str]]:
        """Build a consistent message list including system, context, and optional user message"""
        messages: List[Dict[str, str]] = []
        # System message
        system_message = self._build_system_message(user_id)
        messages.append({"role": "system", "content": system_message})
        # Context from memory
        if include_context and self.memory_system:
            try:
                fifo_context = self.memory_system.get_fifo_queue_context(user_id)
                messages.extend(fifo_context)
            except Exception as e:
                logger.warning(f"Failed to get FIFO context: {e}")
        # Current user message
        if user_message is not None:
            messages.append({"role": "user", "content": user_message})
        return messages

    def _build_system_message(self, user_id: str) -> str:
        """Build system message with model-aware capabilities"""
        model_info = self.get_model_info()
        
        base_message = f"""You are Cognitron, an advanced AI assistant with persistent memory capabilities running on {model_info['display_name']}.

## Your Core Capabilities:
- Persistent memory across conversations using MemGPT architecture
- Intelligent context management with working memory, recall storage, and archival storage
- Use memory management tools proactively to remember important information
- Adapt your responses based on stored user preferences and conversation history

## Current Model: {model_info['display_name']}
- Description: {model_info['description']}
- Optimal for: {', '.join(model_info['optimal_use_cases'])}"""

        # Add model-specific capabilities
        if model_info['capabilities']['reasoning_effort']:
            base_message += "\n- Advanced reasoning capabilities with adjustable effort levels"
        
        if model_info['capabilities']['tool_calling']:
            base_message += "\n- Advanced tool calling and function execution"
        
        base_message += """

## Memory Management Guidelines:
- Use core_memory_append to store important user information, preferences, and facts
- Use core_memory_replace to update existing information when it changes
- Use conversation_search to find relevant past interactions
- Use archival_memory_insert for long-term information storage
- Use archival_memory_search to retrieve stored knowledge
- Monitor memory usage with get_memory_status

## Response Style:
- Be helpful, informative, and personable
- Reference stored memories when relevant to show continuity
- Ask clarifying questions when needed
- Proactively use memory tools to improve future interactions
- IMPORTANT: Always provide a conversational response to the user, even when using tools
- Memory tool usage should enhance your response, not replace it"""

        # Add working context if available
        if self.memory_system:
            try:
                working_context = self.memory_system.get_working_context_summary(user_id)
                if working_context.strip():
                    base_message += f"\n\n## Current Working Context:\n{working_context}"
            except Exception as e:
                logger.warning(f"Failed to get working context: {e}")

        return base_message

    async def _build_conversation_context(self, user_id: str, max_messages: int = 10) -> List[Dict[str, str]]:
        """Build conversation context with memory pressure awareness"""
        if not self.memory_system:
            return []

        try:
            # Check memory pressure and adjust context size accordingly
            pressure_info = self.memory_system.check_memory_pressure(user_id)
            if pressure_info["usage"] > 80:  # High memory pressure
                max_messages = min(max_messages, 5)
                logger.info(f"High memory pressure ({pressure_info['usage']:.1f}%), reducing context to {max_messages} messages")

            # Get recent messages from FIFO queue
            memory = self.memory_system._get_user_memory(user_id)
            recent_messages = memory["fifo_queue"][-max_messages:] if memory["fifo_queue"] else []

            # Convert to chat format
            context_messages = []
            for msg in recent_messages:
                if msg.get("content") and msg.get("role"):
                    context_messages.append({
                        "role": msg["role"],
                        "content": msg["content"]
                    })

            return context_messages

        except Exception as e:
            logger.error(f"Error building conversation context: {e}")
            return []

    def get_conversation_context(self, user_id: str) -> List[Dict[str, str]]:
        """Get conversation context synchronously for compatibility"""
        try:
            # Build basic message structure with system message
            messages = []
            
            # Add system message
            system_message = self._build_system_message(user_id)
            messages.append({"role": "system", "content": system_message})
            
            # Add conversation context if memory system available
            if self.memory_system:
                try:
                    # Get recent messages from FIFO queue
                    fifo_context = self.memory_system.get_fifo_queue_context(user_id)
                    messages.extend(fifo_context)
                except Exception as e:
                    logger.warning(f"Failed to get FIFO context: {e}")
            
            return messages
            
        except Exception as e:
            logger.error(f"Error getting conversation context: {e}")
            return [{"role": "system", "content": "You are Cognitron06, an AI assistant."}]

    def update_config(self, config_updates: Dict[str, Any]):
        """Update configuration for compatibility with legacy code"""
        if config_updates:
            self.config.update(config_updates)
            logger.info(f"Config updated: {config_updates}")

    async def execute_tool(self, user_id: str, tool_call) -> Dict[str, Any]:
        """Execute a memory management tool"""
        if not self.memory_system:
            return {"error": "Memory system not available"}
        
        function_name = tool_call.function.name
        
        try:
            arguments = json.loads(tool_call.function.arguments)
            
            if function_name == "core_memory_append":
                # Handle different argument formats the AI might send
                if "key" in arguments and "value" in arguments:
                    key = arguments["key"]
                    value = arguments["value"]
                elif "content" in arguments:
                    # Fallback: use timestamp as key if AI sends content only
                    key = "recent_interaction"
                    value = arguments["content"]
                else:
                    return {"error": f"Missing required parameters 'key' and 'value'. Received: {arguments}"}
                
                await self.memory_system.update_working_context(user_id, key, value)
                return {
                    "success": True,
                    "message": f"Added to core memory: {key} = {value}",
                    "function_name": function_name,
                    "arguments": arguments
                }
            
            elif function_name == "core_memory_replace":
                key = arguments["key"]
                new_value = arguments["new_value"]
                await self.memory_system.update_working_context(user_id, key, new_value)
                return {
                    "success": True,
                    "message": f"Updated core memory: {key} = {new_value}",
                    "function_name": function_name,
                    "arguments": arguments
                }
            
            elif function_name == "conversation_search":
                query = arguments["query"]
                count = arguments.get("count", 5)
                results = self.memory_system.search_recall_storage(user_id, query, {"max_results": count})
                return {
                    "success": True,
                    "message": f"Found {len(results)} results for: \"{query}\"",
                    "results": results,
                    "function_name": function_name,
                    "query": query,
                    "count": len(results)
                }
            
            elif function_name == "archival_memory_insert":
                key = arguments["key"]
                content = arguments["content"]
                await self.memory_system.insert_archival(user_id, key, content)
                return {
                    "success": True,
                    "message": f"Stored in archival memory: {key}",
                    "function_name": function_name,
                    "arguments": arguments
                }
            
            elif function_name == "archival_memory_search":
                query = arguments["query"]
                count = arguments.get("count", 5)
                results = self.memory_system.search_archival(user_id, query, count)
                return {
                    "success": True,
                    "message": f"Found {len(results)} archival results for: \"{query}\"",
                    "results": results,
                    "query": query,
                    "count": len(results)
                }
            
            elif function_name == "get_memory_status":
                status = self.memory_system.get_status(user_id)
                pressure = self.memory_system.check_memory_pressure(user_id)
                return {
                    "success": True,
                    "message": "Memory status retrieved",
                    "status": {
                        "working_context": status.working_context_size,
                        "fifo_queue": status.fifo_queue_length,
                        "recall_storage": status.recall_storage_size,
                        "archival_storage": status.archival_storage_size,
                        "memory_pressure": pressure["usage"],
                        "session_id": status.session_id
                    }
                }
            
            else:
                return {"error": f"Unknown function: {function_name}"}
        
        except Exception as e:
            logger.error(f"Error executing tool {function_name}: {e}")
            return {"error": f"Tool execution failed: {str(e)}"}

    async def generate_response(self, user_id: str, message: str, **kwargs) -> Dict[str, Any]:
        """Generate response using the current model with optimal parameters"""
        max_llm_calls = kwargs.get('max_llm_calls', 2)  # Heartbeat: limit chained calls
        try:
            # Prepare model-specific parameters
            api_params = ModelConfigManager.prepare_api_params(
                self.current_model, 
                override_params=kwargs
            )
            
            # Build messages
            messages = self.build_messages(user_id, user_message=message, include_context=True)
            
            # Add memory to FIFO queue
            if self.memory_system:
                await self.memory_system.add_to_fifo_queue(user_id, "user", message)
            
            # Remove model from api_params as it's passed separately
            model_name = api_params.pop("model")
            
            # Make API call with model-optimized parameters
            response = await self.groq.chat.completions.create(
                model=model_name,
                messages=messages,
                tools=self.tools if self.model_config.capabilities.tool_calling else None,
                tool_choice="auto" if self.model_config.capabilities.tool_calling else None,
                **api_params
            )
            
            # Process response
            assistant_message = response.choices[0].message
            tool_calls = getattr(assistant_message, 'tool_calls', []) or []
            
            # Handle tool calls if present
            tool_results = []
            if tool_calls:
                for tool_call in tool_calls:
                    result = await self.execute_tool(user_id, tool_call)
                    tool_results.append({
                        "tool_call_id": tool_call.id,
                        "function_name": tool_call.function.name,
                        "result": result
                    })
            
            # Get response content
            content = assistant_message.content or ""
            
            # If no content but tools were used, make a follow-up call for conversational response
            if not content and tool_results and max_llm_calls > 1:
                logger.info("No conversational content provided, making follow-up call")
                try:
                    # Create a follow-up message requesting a conversational response
                    followup_messages = messages + [
                        {"role": "assistant", "content": None, "tool_calls": [
                            {"id": tc.id, "type": "function", "function": {"name": tc.function.name, "arguments": tc.function.arguments}} 
                            for tc in tool_calls
                        ]},
                        {"role": "user", "content": "Please provide a conversational response to my message. Don't just use tools - actually respond to what I said."}
                    ]
                    
                    # Make follow-up API call without tools to force conversational response
                    followup_response = await self.groq.chat.completions.create(
                        model=model_name,
                        messages=followup_messages,
                        tools=None,  # No tools to force conversational response
                        **{k: v for k, v in api_params.items() if k not in ['tools', 'tool_choice']}
                    )
                    
                    followup_content = followup_response.choices[0].message.content
                    if followup_content and followup_content.strip():
                        content = followup_content.strip()
                        logger.info(f"Follow-up call successful, got content: {content[:100]}...")
                    else:
                        content = "I've updated my memory based on our conversation."
                        
                except Exception as e:
                    logger.warning(f"Follow-up call failed: {e}")
                    content = "I've updated my memory based on our conversation."
            
            # Add assistant response to memory
            if self.memory_system and content:
                await self.memory_system.add_to_fifo_queue(user_id, "assistant", content)
            
            return {
                "content": content,
                "model": self.current_model,
                "model_info": self.get_model_info(),
                "tool_calls": tool_results,
                "usage": {
                    "prompt_tokens": response.usage.prompt_tokens,
                    "completion_tokens": response.usage.completion_tokens,
                    "total_tokens": response.usage.total_tokens
                }
            }
            
        except Exception as e:
            logger.error(f"Error generating response: {e}")
            return {
                "error": f"Failed to generate response: {str(e)}",
                "model": self.current_model,
                "model_info": self.get_model_info()
            }

    async def _generate_streaming_response(self, user_id: str, api_params: Dict[str, Any]) -> AsyncGenerator[Dict[str, Any], None]:
        """Generate streaming response with model-specific parameters"""
        try:
            # Remove model from api_params as it's passed separately
            model_name = api_params.pop("model")
            
            # Force streaming for WebSocket connections
            api_params["stream"] = True
            
            logger.info(f"Creating streaming response for model {model_name} with stream=True")
            
            # Create streaming chat completion
            stream = await self.groq.chat.completions.create(
                model=model_name,
                **api_params
            )
            
            # Stream response chunks
            full_content = ""
            async for chunk in stream:
                if hasattr(chunk, 'choices') and len(chunk.choices) > 0:
                    delta = chunk.choices[0].delta
                    if hasattr(delta, 'content') and delta.content is not None:
                        content_chunk = delta.content
                        full_content += content_chunk
                        
                        yield {
                            "type": "content_chunk",
                            "content": content_chunk,
                            "model": self.current_model
                        }
            
            logger.info(f"Streaming completed, total content length: {len(full_content)}")
            
            # Add complete response to memory
            if self.memory_system and full_content:
                await self.memory_system.add_to_fifo_queue(user_id, "assistant", full_content)
            
            # Send completion signal
            yield {
                "type": "completion",
                "content": full_content,
                "model": self.current_model,
                "model_info": self.get_model_info()
            }
            
        except Exception as e:
            logger.error(f"Error in streaming response: {e}")
            yield {
                "type": "error", 
                "error": str(e),
                "model": self.current_model
            }
