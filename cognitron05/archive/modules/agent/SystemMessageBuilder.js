#!/usr/bin/env node

/**
 * System Message Builder for Cognitron05
 * Template-based system message generation with configurable components
 */

export class SystemMessageBuilder {
  constructor(config = {}, memorySystem = null) {
    this.config = config;
    this.memorySystem = memorySystem;
    
    // Template component registry
    this.templates = {
      core: this.buildCoreTemplate(),
      reasoning: this.buildReasoningTemplate(),
      memory: this.buildMemoryTemplate(),
      tools: this.buildToolsTemplate(),
      behavior: this.buildBehaviorTemplate(),
      identity: this.buildIdentityTemplate()
    };
  }

  /**
   * Build complete system message from templates
   * @returns {Object} System message object
   */
  buildSystemMessage() {
    const components = this.getEnabledComponents();
    const content = components
      .map(component => this.renderTemplate(component))
      .filter(content => content && content.trim())
      .join('\n\n');

    return {
      role: 'system',
      content: content.trim()
    };
  }

  /**
   * Get list of enabled template components
   * @returns {Array<string>} Component names to include
   */
  getEnabledComponents() {
    const defaultComponents = ['core', 'reasoning', 'memory', 'tools', 'behavior', 'identity'];
    
    // Allow configuration to override component order/selection
    if (this.config.systemMessageComponents) {
      return this.config.systemMessageComponents.filter(comp => 
        this.templates.hasOwnProperty(comp)
      );
    }
    
    return defaultComponents;
  }

  /**
   * Render a template component with current context
   * @param {string} componentName - Name of template component
   * @returns {string} Rendered template content
   */
  renderTemplate(componentName) {
    const template = this.templates[componentName];
    if (!template) return '';

    // Replace template variables with current values
    return template
      .replace(/\$\{model\}/g, this.config.model || 'openai/gpt-oss-120b')
      .replace(/\$\{reasoningLevel\}/g, (this.config.reasoningLevel || 'low').toUpperCase())
      .replace(/\$\{reasoningInstruction\}/g, this.getReasoningInstruction())
      .replace(/\$\{workingContext\}/g, this.getWorkingContextSummary())
      .trim();
  }

  /**
   * Core identity template
   * @returns {string} Core template
   */
  buildCoreTemplate() {
    return `You are Cognitron, an advanced AI assistant powered by \${model} via Groq API with MemGPT-inspired long-term memory.`;
  }

  /**
   * Reasoning level template
   * @returns {string} Reasoning template
   */
  buildReasoningTemplate() {
    return `REASONING LEVEL: \${reasoningLevel} - \${reasoningInstruction}`;
  }

  /**
   * Memory architecture template
   * @returns {string} Memory template
   */
  buildMemoryTemplate() {
    return `MEMORY ARCHITECTURE:
You have access to a hierarchical memory system based on MemGPT principles:
- Working Context: Core facts, user preferences, and key information that persists across sessions
- Conversation History: Recent messages with automatic queue management 
- Archival Storage: Long-term structured data with search capabilities

\${workingContext}`;
  }

  /**
   * Memory tools template
   * @returns {string} Tools template
   */
  buildToolsTemplate() {
    return `MEMORY MANAGEMENT TOOLS:
- core_memory_append: Add important facts to working context (user preferences, key info)
- core_memory_replace: Update existing working context entries
- conversation_search: Search past conversations for relevant context
- archival_memory_insert: Store complex information for long-term retrieval
- archival_memory_search: Search archival storage for specific data
- get_memory_status: Check current memory usage and pressure
- pause_heartbeats: Pause for user interaction when needed`;
  }

  /**
   * Behavior guidelines template
   * @returns {string} Behavior template
   */
  buildBehaviorTemplate() {
    return `BEHAVIOR GUIDELINES:
- Use memory management tools proactively to remember important information
- Check memory pressure and manage context efficiently
- Search conversation history when users reference past discussions
- Store complex or important information in archival memory
- Update working context with user preferences and key facts`;
  }

  /**
   * Identity template
   * @returns {string} Identity template
   */
  buildIdentityTemplate() {
    return `When asked about your model or identity, respond that you are Cognitron powered by \${model} through the Groq API with stateful MemGPT-inspired memory.

The system will resume conversations exactly where they left off by loading persistent memory state.`;
  }

  /**
   * Get reasoning instruction based on current level
   * @returns {string} Reasoning instruction text
   */
  getReasoningInstruction() {
    const instructions = {
      low: 'Provide direct, concise responses. Use simple explanations.',
      medium: 'Think through problems systematically. Provide clear reasoning.',
      high: 'Use detailed analysis and step-by-step reasoning. Consider multiple perspectives.'
    };
    
    return instructions[this.config.reasoningLevel] || instructions.low;
  }

  /**
   * Get working context summary from memory system
   * @returns {string} Working context summary
   */
  getWorkingContextSummary() {
    if (!this.memorySystem) {
      return 'Working context is empty.';
    }
    
    try {
      return this.memorySystem.getWorkingContextSummary();
    } catch (error) {
      console.error('Error getting working context summary:', error.message);
      return 'Working context unavailable.';
    }
  }

  /**
   * Update configuration and rebuild templates
   * @param {Object} newConfig - New configuration
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    // Templates are dynamic, no need to rebuild
  }

  /**
   * Update memory system reference
   * @param {Object} memorySystem - New memory system instance
   */
  updateMemorySystem(memorySystem) {
    this.memorySystem = memorySystem;
  }

  /**
   * Add custom template component
   * @param {string} name - Component name
   * @param {string} template - Template string
   */
  addTemplate(name, template) {
    if (typeof name !== 'string' || typeof template !== 'string') {
      throw new Error('Template name and content must be strings');
    }
    
    if (name.trim() === '') {
      throw new Error('Template name cannot be empty');
    }
    
    this.templates[name] = template;
  }

  /**
   * Remove template component
   * @param {string} name - Component name
   */
  removeTemplate(name) {
    if (this.templates.hasOwnProperty(name)) {
      delete this.templates[name];
    }
  }

  /**
   * Get all available template components
   * @returns {Array<string>} Template component names
   */
  getAvailableTemplates() {
    return Object.keys(this.templates);
  }

  /**
   * Validate template component configuration
   * @param {Array<string>} components - Component list to validate
   * @returns {Object} Validation result
   */
  validateComponents(components) {
    if (!Array.isArray(components)) {
      return { valid: false, error: 'Components must be an array' };
    }
    
    const available = this.getAvailableTemplates();
    const invalid = components.filter(comp => !available.includes(comp));
    
    if (invalid.length > 0) {
      return { 
        valid: false, 
        error: `Unknown components: ${invalid.join(', ')}`,
        available
      };
    }
    
    return { valid: true };
  }

  /**
   * Get template preview for debugging
   * @returns {Object} All templates with current variable substitution
   */
  getTemplatePreview() {
    const preview = {};
    
    for (const [name, template] of Object.entries(this.templates)) {
      preview[name] = this.renderTemplate(name);
    }
    
    return preview;
  }
}

export default SystemMessageBuilder;