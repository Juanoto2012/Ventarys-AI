import { AIEngine, AIMessage, ProviderConfig, ChatCompletionChunk, getSystemPrompt, getProvider } from './providers.js';
import { unlockVault, saveVault, VaultData } from './security.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

export interface ToolResult {
  tool: string;
  args: string;
  result: string;
  success: boolean;
  exitCode?: number;
}

const TOOL_PATTERNS = {
  search: /\[SEARCH\]:\s*([^\]\n]+)/gi,
  readWebpage: /\[READ_WEBPAGE\]:\s*(https?:\/\/[^\s\]\n]+)/gi,
  searchImage: /\[SEARCH_IMAGE\]:\s*([^\]\n]+)/gi,
  runCmd: /\[RUN_CMD\s*\]:\s*(.+)/gi,
  generateImage: /\[GENERATE_IMAGE\s*:\s*([^\n\]]+)\]|\[GENERATE_IMAGE\]\s*:\s*([^\n\]]+)/gi,
  consultMemory: /\[CONSULT_MEMORY\]/gi,
};

interface SearXNGResult {
  title: string;
  url: string;
  content: string;
}

interface SearXNGResponse {
  results?: SearXNGResult[];
}

interface JinaSearchResult {
  title?: string;
  url?: string;
  content?: string;
}

interface JinaSearchResponse {
  data?: JinaSearchResult[];
}

interface WikiImagePage {
  title: string;
  thumbnail?: { source: string };
  fullurl: string;
}

interface WikiImageResponse {
  query?: {
    pages?: Record<string, WikiImagePage>;
  };
}

interface ImageGenerationResponse {
  data?: Array<{ b64_json?: string; url?: string }>;
  url?: string;
  success?: boolean;
  result?: { url?: string };
}

export class VentarysEngine {
  private engine: AIEngine;
  private vault: VaultData | null = null;
  private messages: AIMessage[] = [];
  private abortSignal: AbortSignal | null = null;
  private onToolStart?: (tool: string, args: string) => void;
  private onToolComplete?: (result: ToolResult) => void;
  private onChunk?: (chunk: string) => void;
  private onComplete?: (fullResponse: string) => void;
  private currentChatId: string | null = null;

  constructor() {
    this.engine = new AIEngine({ provider: 'agnes', model: 'gpt-4o' });
  }

  async initialize(): Promise<void> {
    this.vault = await unlockVault();
    const { defaultModel, defaultProvider } = this.vault.settings;
    const providerInfo = getProvider(defaultProvider);
    const baseURL = this.vault.localEndpoints[defaultProvider] || providerInfo?.baseURL;
    this.engine.setConfig({
      provider: defaultProvider,
      model: defaultModel,
      apiKey: this.vault.apiKeys[defaultProvider],
      baseURL,
    });
    this.messages = [
      { role: 'system', content: getSystemPrompt() },
    ];
  }

  setCallbacks(callbacks: {
    onToolStart?: (tool: string, args: string) => void;
    onToolComplete?: (result: ToolResult) => void;
    onChunk?: (chunk: string) => void;
    onComplete?: (fullResponse: string) => void;
  }): void {
    this.onToolStart = callbacks.onToolStart;
    this.onToolComplete = callbacks.onToolComplete;
    this.onChunk = callbacks.onChunk;
    this.onComplete = callbacks.onComplete;
  }

  setAbortSignal(signal: AbortSignal): void {
    this.abortSignal = signal;
  }

  async switchModel(provider: string, model: string): Promise<void> {
    if (!this.vault) await this.initialize();
    const providerInfo = getProvider(provider);
    const apiKey = this.vault?.apiKeys[provider];
    const baseURL = this.vault?.localEndpoints[provider] || providerInfo?.baseURL;
    this.engine.setConfig({ provider, model, apiKey, baseURL });
    if (this.vault) {
      this.vault.settings.defaultProvider = provider;
      this.vault.settings.defaultModel = model;
      await saveVault(this.vault);
    }
  }

  async addUserMessage(content: string): Promise<void> {
    this.messages.push({ role: 'user', content });
  }

  async addSystemMessage(content: string): Promise<void> {
    this.messages.push({ role: 'system', content });
  }

  async addFileContext(filepath: string): Promise<void> {
    try {
      const content = await fs.readFile(filepath, 'utf8');
      this.messages.push({
        role: 'system',
        content: `--- File: ${filepath} ---\n${content}\n--- End File ---`,
      });
    } catch (error) {
      throw new Error(`Failed to read file: ${error}`);
    }
  }

  async *streamResponse(): AsyncGenerator<string> {
    let fullResponse = '';
    let toolBuffer = '';
    let maxIterations = 5;
    let iteration = 0;

    while (iteration < maxIterations) {
      iteration++;
      let iterationResponse = '';

      for await (const chunk of this.engine.streamChat(this.messages)) {
        if (this.abortSignal?.aborted) {
          this.engine.abort();
          break;
        }

        if (chunk.content) {
          iterationResponse += chunk.content;
          fullResponse += chunk.content;
          toolBuffer += chunk.content;
          this.onChunk?.(chunk.content);
          yield chunk.content;
        }

        const tools = this.extractTools(toolBuffer);
        for (const tool of tools) {
          const startIdx = toolBuffer.indexOf(tool.fullMatch);
          if (startIdx !== -1) {
            toolBuffer = toolBuffer.slice(0, startIdx) + toolBuffer.slice(startIdx + tool.fullMatch.length);
          }
          
          this.onToolStart?.(tool.name, tool.args);
          const result = await this.executeTool(tool.name, tool.args);
          this.onToolComplete?.(result);
          
          const toolCallId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
          this.messages.push({
            role: 'tool',
            content: result.result,
            toolName: tool.name,
            toolCallId,
          });
          
          yield `\n[Tool Result: ${tool.name}]\n${result.result}\n`;
        }

        if (chunk.done) {
          break;
        }
      }

      this.messages.push({ role: 'assistant', content: iterationResponse });
      
      const hasMoreTools = toolBuffer.match(/\[(SEARCH|READ_WEBPAGE|SEARCH_IMAGE|RUN_CMD|GENERATE_IMAGE|CONSULT_MEMORY)\]/i);
      if (!hasMoreTools) {
        if (this.vault?.settings.autoSave) {
          await this.saveConversation();
        }
        this.onComplete?.(fullResponse);
        break;
      }
    }
  }

  private extractTools(text: string): Array<{ name: string; args: string; fullMatch: string }> {
    const tools: Array<{ name: string; args: string; fullMatch: string }> = [];
    
    for (const [name, pattern] of Object.entries(TOOL_PATTERNS)) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        let args = '';
        if (name === 'generateImage') {
          args = (match[1] || match[2] || '').trim();
        } else {
          args = match[1]?.trim() || '';
        }
        tools.push({
          name: name.toUpperCase()
            .replace('SEARCHIMAGE', 'SEARCH_IMAGE')
            .replace('READWEBPAGE', 'READ_WEBPAGE')
            .replace('GENERATEIMAGE', 'GENERATE_IMAGE')
            .replace('CONSULTMEMORY', 'CONSULT_MEMORY')
            .replace('RUNCMD', 'RUN_CMD'),
          args,
          fullMatch: match[0],
        });
      }
      pattern.lastIndex = 0;
    }
    
    return tools;
  }

  private async executeTool(name: string, args: string): Promise<ToolResult> {
    switch (name.toUpperCase()) {
      case 'SEARCH':
        return this.executeSearch(args);
      case 'READ_WEBPAGE':
        return this.executeReadWebpage(args);
      case 'SEARCH_IMAGE':
        return this.executeSearchImage(args);
      case 'RUN_CMD':
        return this.executeRunCmd(args);
      case 'GENERATE_IMAGE':
        return this.executeGenerateImage(args);
      case 'CONSULT_MEMORY':
        return this.executeConsultMemory();
      default:
        return { tool: name, args, result: `Unknown tool: ${name}`, success: false };
    }
  }

  private async executeSearch(query: string): Promise<ToolResult> {
    try {
      const results = await this.performWebSearch(query);
      if (results.length === 0) {
        return { tool: 'SEARCH', args: query, result: 'No results found', success: true };
      }
      
      const formatted = results.map((r, i) => 
        `${i + 1}. ${r.title}\n   URL: ${r.url}\n   Snippet: ${r.content}`
      ).join('\n\n');
      
      return { tool: 'SEARCH', args: query, result: formatted, success: true };
    } catch (error) {
      return { tool: 'SEARCH', args: query, result: `Search failed: ${error}`, success: false };
    }
  }

  private async performWebSearch(query: string): Promise<Array<{ title: string; url: string; content: string }>> {
    const SEARXNG_INSTANCES = [
      "https://searx.party/search",
      "https://etsi.me/search",
      "https://sx.xo.st/search",
      "https://searxng.gr/search"
    ];

    for (const instance of SEARXNG_INSTANCES) {
      try {
        const response = await fetch(`${instance}?q=${encodeURIComponent(query)}&format=json&language=auto&safesearch=2`, {
          headers: { "Accept": "application/json" }
        });
        if (!response.ok) continue;
        const data = await response.json() as SearXNGResponse;
        if (data && Array.isArray(data.results) && data.results.length > 0) {
          return data.results.slice(0, 5).map((r: SearXNGResult) => ({
            title: r.title || 'Untitled',
            url: r.url || '',
            content: (r.content || '').substring(0, 500)
          }));
        }
      } catch {
        continue;
      }
    }

    try {
      const fallback = await this.performJinaSearch(query);
      if (fallback.length > 0) return fallback;
    } catch {}

    throw new Error("No results from any search instance");
  }

  private async performJinaSearch(query: string): Promise<Array<{ title: string; url: string; content: string }>> {
    try {
      const response = await fetch(`https://s.jina.ai/${encodeURIComponent(query)}`, {
        headers: { 'Accept': 'application/json' }
      });
      if (!response.ok) throw new Error("Jina search failed");
      const data = await response.json() as JinaSearchResponse;
      if (data.data && Array.isArray(data.data)) {
        return data.data.slice(0, 5).map((r: JinaSearchResult) => ({
          title: r.title || 'Untitled',
          url: r.url || '',
          content: (r.content || '').substring(0, 500)
        }));
      }
    } catch {}
    return [];
  }

  private async executeReadWebpage(url: string): Promise<ToolResult> {
    try {
      const response = await fetch(`https://r.jina.ai/${encodeURIComponent(url)}`, {
        headers: { 'Accept': 'text/event-stream', 'X-Return-Format': 'markdown' }
      });
      if (!response.ok) throw new Error("Jina AI reader failed");
      const text = await response.text();
      return { tool: 'READ_WEBPAGE', args: url, result: text.substring(0, 15000), success: true };
    } catch (error) {
      return { tool: 'READ_WEBPAGE', args: url, result: `Read failed: ${error}`, success: false };
    }
  }

  private async executeSearchImage(query: string): Promise<ToolResult> {
    try {
      const images = await this.performWikiImageSearch(query);
      if (images.length === 0) {
        return { tool: 'SEARCH_IMAGE', args: query, result: 'No free images found', success: true };
      }
      
      const formatted = images.map((img, i) => 
        `${i + 1}. ${img.title}\n   Image: ${img.url}\n   Page: ${img.pageUrl}`
      ).join('\n\n');
      
      return { tool: 'SEARCH_IMAGE', args: query, result: formatted, success: true };
    } catch (error) {
      return { tool: 'SEARCH_IMAGE', args: query, result: `Image search failed: ${error}`, success: false };
    }
  }

  private async performWikiImageSearch(query: string): Promise<Array<{ title: string; url: string; pageUrl: string }>> {
    try {
      const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages|info&inprop=url&generator=search&gsrsearch=${encodeURIComponent(query)}&pithumbsize=800&origin=*`;
      const response = await fetch(url);
      const data = await response.json() as WikiImageResponse;
      if (data.query && data.query.pages) {
        const pages = Object.values(data.query.pages) as WikiImagePage[];
        const withImages = pages.filter(p => p.thumbnail);
        if (withImages.length > 0) {
          return withImages.slice(0, 3).map(p => ({
            title: p.title,
            url: p.thumbnail!.source,
            pageUrl: p.fullurl
          }));
        }
      }
    } catch {}
    return [];
  }

  private async executeRunCmd(command: string): Promise<ToolResult> {
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'cmd.exe' : 'sh';
    const args = isWindows ? ['/c', command] : ['-c', command];
    
    return new Promise((resolve) => {
      const proc = spawn(shell, args, {
        cwd: process.cwd(),
        env: { ...process.env },
        shell: false,
      });
      
      let stdout = '';
      let stderr = '';
      
      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });
      
      proc.on('error', (error) => {
        resolve({ tool: 'RUN_CMD', args: command, result: `Execution failed: ${error}`, success: false, exitCode: -1 });
      });
      
      proc.on('close', (exitCode) => {
        const output = stdout + (stderr ? `\n[stderr]\n${stderr}` : '');
        const success = exitCode === 0;
        resolve({ 
          tool: 'RUN_CMD', 
          args: command, 
          result: output.trim() || '(no output)', 
          success,
          exitCode: exitCode || 0
        });
      });
    });
  }

  private async executeGenerateImage(prompt: string): Promise<ToolResult> {
    try {
      const apiKey = this.vault?.apiKeys.agnes;
      if (!apiKey) {
        return { tool: 'GENERATE_IMAGE', args: prompt, result: 'Image generation requires an Agnes AI API key', success: false };
      }

      const outputDir = path.join(process.cwd(), 'ventarys_outputs');
      await fs.mkdir(outputDir, { recursive: true });

      const endpoint = 'https://apihub.agnes-ai.com/v1/images/generations';
      const imageModel = (globalThis as any).currentImageModelId || 'flux';
      
      const payload = { prompt, n: 1, model: imageModel };
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API Error (${response.status}): ${error}`);
      }

      const data = await response.json() as ImageGenerationResponse;
      
      let finalImgUrl = "", base64Data = null;
      
      if (data.data && data.data.length > 0) {
        if (data.data[0].b64_json) base64Data = "data:image/png;base64," + data.data[0].b64_json;
        else if (data.data[0].url) finalImgUrl = data.data[0].url;
      } else if (data.url) finalImgUrl = data.url;
      else if (data.success && data.result && data.result.url) finalImgUrl = data.result.url;
      else throw new Error("Invalid response format");

      const finalImageSrc = base64Data ? base64Data : finalImgUrl;
      
      if (base64Data) {
        const filename = `generated_${Date.now()}.png`;
        const filepath = path.join(outputDir, filename);
        const buffer = Buffer.from(base64Data.split(',')[1], 'base64');
        await fs.writeFile(filepath, buffer);
        return { tool: 'GENERATE_IMAGE', args: prompt, result: `Image saved to: ${filepath}`, success: true };
      }

      return { tool: 'GENERATE_IMAGE', args: prompt, result: finalImageSrc, success: true };
    } catch (error) {
      return { tool: 'GENERATE_IMAGE', args: prompt, result: `Generation failed: ${error}`, success: false };
    }
  }

  private async executeConsultMemory(): Promise<ToolResult> {
    if (!this.vault) {
      return { tool: 'CONSULT_MEMORY', args: '', result: 'No vault available', success: false };
    }

    const chat = this.vault.chatHistory.find(c => c.id === this.currentChatId);
    if (!chat || !chat.messages.length) {
      return { tool: 'CONSULT_MEMORY', args: '', result: 'No conversation history to summarize', success: true };
    }

    const memory = chat.memory || 'No compacted memories have been established yet for this conversation.';
    return { tool: 'CONSULT_MEMORY', args: '', result: memory, success: true };
  }

  private async saveConversation(): Promise<void> {
    if (!this.vault || !this.currentChatId) return;
    
    const session = this.vault.chatHistory.find(c => c.id === this.currentChatId);
    if (!session) return;

    session.messages = this.messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
        timestamp: Date.now(),
      }));
    session.updatedAt = Date.now();
    await saveVault(this.vault);
  }

  async compactConversation(chatId: string): Promise<void> {
    if (!this.vault) return;
    
    const chat = this.vault.chatHistory.find(c => c.id === chatId);
    if (!chat || !chat.messages.length || chat.messages.length <= 15) return;

    const msgsToCompact = chat.messages.slice(0, chat.messages.length - 6);
    if (msgsToCompact.length < 5) return;

    const textToCompact = msgsToCompact.map(m => `${m.role}: ${m.content}`).join('\n');
    const prompt = `As Ventarys, your task is to heavily compress and summarize this past conversation segment. Retain ALL crucial facts, your FOSS principles, code snippets, architectural decisions, and user preferences. Drop pleasantries.

Old Memory Summary: ${chat.memory || 'None'}

New Conversation Segment to Compress:
${textToCompact}`;

    try {
      const tempEngine = new AIEngine(this.engine.config);
      let summaryText = '';
      for await (const chunk of tempEngine.streamChat([{ role: 'user', content: prompt }])) {
        summaryText += chunk.content;
      }

      if (summaryText.length > 50) {
        chat.memory = summaryText;
        chat.messages.splice(0, msgsToCompact.length);
        await saveVault(this.vault);
      }
    } catch (e) {
      // Silently fail
    }
  }

  getMessages(): AIMessage[] {
    return [...this.messages];
  }

  getVault(): VaultData | null {
    return this.vault;
  }

  clearHistory(): void {
    this.messages = [{ role: 'system', content: getSystemPrompt() }];
  }

  setCurrentChatId(id: string): void {
    this.currentChatId = id;
  }
}