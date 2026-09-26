import * as fs from 'fs/promises';
import * as path from 'path';

export interface AIProvider {
  name: string;
  models: string[];
  baseURL: string;
  requiresApiKey: boolean;
  isCustom?: boolean;
  isLocal?: boolean;
  defaultModel?: string;
}

export interface ChatCompletionChunk {
  content: string;
  done: boolean;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface AIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolName?: string;
}

export interface ProviderConfig {
  provider: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
}

const BUILTIN_PROVIDERS: Record<string, AIProvider> = {
  agnes: {
    name: 'Agnes AI',
    models: [],
    baseURL: 'https://apihub.agnes-ai.com/v1',
    requiresApiKey: true,
    defaultModel: 'gpt-4o',
  },
  localnode: {
    name: 'Local AI',
    models: [],
    baseURL: '',
    requiresApiKey: false,
    isLocal: true,
    defaultModel: 'local-model',
  },
};

export function getBuiltinProviders(): Record<string, AIProvider> {
  return BUILTIN_PROVIDERS;
}

export function getProvider(key: string): AIProvider | undefined {
  return BUILTIN_PROVIDERS[key];
}

const WEBGPU_MODELS = [
  { id: 'Llama-3.2-1B-Instruct-q4f32_1-MLC', name: 'Llama 3.2 1B (f32, ~1.1 GB VRAM)', f32: true },
  { id: 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC', name: 'Qwen 2.5 0.5B (f32, ~1 GB VRAM)', f32: true },
  { id: 'SmolLM-360M-Instruct-q4f32_1-MLC', name: 'SmolLM 360M (f32, ~420 MB VRAM)', f32: true },
  { id: 'gemma-2-2b-it-q4f32_1-MLC', name: 'Gemma 2 2B (f32, ~2.5 GB VRAM)', f32: true },
  { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', name: 'Llama 3.2 1B (f16, ~880 MB, needs modern GPU)', f32: false },
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', name: 'Qwen 2.5 1.5B (f16, ~1.6 GB, needs modern GPU)', f32: false },
];

export function getWebGPUModels(): typeof WEBGPU_MODELS {
  return WEBGPU_MODELS;
}

export async function fetchModels(baseURL: string, apiKey?: string): Promise<string[]> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    
    const cleanBaseURL = baseURL.replace(/\/v1\/?$/, '').replace(/\/chat\/completions\/?$/, '');
    const response = await fetch(`${cleanBaseURL}/v1/models`, { headers });
    if (!response.ok) return [];
    
    const data = await response.json() as { data?: Array<{ id: string; type?: string }> };
    if (!data.data) return [];
    
    return data.data
      .filter(m => m.id && m.type !== 'image' && !isImageModel(m.id) && !isVideoModel(m))
      .map(m => m.id);
  } catch {
    return [];
  }
}

function isImageModel(id: string): boolean {
  const lower = id.toLowerCase();
  return lower.includes('image') || lower.includes('dall') || lower.includes('flux') || lower.includes('midjourney');
}

function isVideoModel(m: { id: string; type?: string }): boolean {
  const type = (m.type || '').toLowerCase();
  const id = (m.id || '').toLowerCase();
  const videoHints = ['video', 'sora', 'kling', 'veo', 'runway', 'pika', 'luma', 'hailuo', 'cogvideo', 'wan2'];
  return type === 'video' || videoHints.some(h => id.includes(h) || type.includes(h));
}

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

export class AIEngine {
  private configValue: ProviderConfig;
  private abortController: AbortController | null = null;
  private webllmModule: any = null;
  private webgpuEngine: any = null;

  constructor(config: ProviderConfig) {
    this.configValue = config;
  }

  get config(): ProviderConfig {
    return this.configValue;
  }

  setConfig(config: ProviderConfig): void {
    this.configValue = config;
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();
  }

  async *streamChat(messages: AIMessage[]): AsyncGenerator<ChatCompletionChunk> {
    this.abortController = new AbortController();
    
    const provider = getProvider(this.configValue.provider);
    const isLocalNode = this.configValue.provider === 'localnode';
    const isWebGPU = isLocalNode && (globalThis as any).localNodeSettings?.engine === 'webgpu';
    
    if (isWebGPU) {
      yield* this.streamWebGPU(messages);
      return;
    }
    
    const baseURL = this.configValue.baseURL || provider?.baseURL || 'https://api.openai.com/v1';
    const apiKey = this.configValue.apiKey;
    
    const isAnthropic = this.configValue.provider === 'anthropic';
    const endpoint = isAnthropic 
      ? `${baseURL}/messages`
      : `${baseURL}/chat/completions`;

    const body = isAnthropic ? {
      model: this.configValue.model,
      max_tokens: 8192,
      messages: formatMessagesForProvider(messages.filter(m => m.role !== 'system'), 'anthropic'),
      system: messages.filter(m => m.role === 'system').map(m => m.content).join('\n'),
      stream: true,
    } : {
      model: this.configValue.model,
      messages: formatMessagesForProvider(messages, this.configValue.provider),
      stream: true,
      temperature: 0.7,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (isAnthropic) {
      headers['x-api-key'] = apiKey || '';
      headers['anthropic-version'] = '2023-06-01';
    } else if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    } else if (isLocalNode && (globalThis as any).localNodeSettings?.key) {
      headers['Authorization'] = `Bearer ${(globalThis as any).localNodeSettings.key}`;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: this.abortController.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API Error (${response.status}): ${error}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
              yield { content: '', done: true };
              return;
            }
            try {
              const parsed = JSON.parse(data);
              let content = '';
              
              if (isAnthropic) {
                if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                  content = parsed.delta.text;
                }
              } else {
                content = parsed.choices?.[0]?.delta?.content || '';
              }
              
              if (content) {
                yield { content, done: false };
              }
            } catch {
              // Ignore parse errors for malformed chunks
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { content: '', done: true };
  }

  private async *streamWebGPU(messages: AIMessage[]): AsyncGenerator<ChatCompletionChunk> {
    try {
      if (!this.webllmModule) {
        this.webllmModule = await import('@mlc-ai/web-llm');
      }
      
      const modelId = (globalThis as any).localNodeSettings?.webgpuModel || WEBGPU_MODELS[0].id;
      
      if (!this.webgpuEngine || this.webgpuEngine.modelId !== modelId) {
        const progressCb = (r: any) => {
          // Could emit progress here
        };
        this.webgpuEngine = await this.webllmModule.CreateMLCEngine(modelId, { initProgressCallback: progressCb });
      }
      
      if (!this.webgpuEngine) {
        throw new Error("Failed to initialize WebGPU engine");
      }
      
      const stream = await this.webgpuEngine.chat.completions.create({ messages, stream: true });
      
      for await (const chunk of stream) {
        if (this.abortController?.signal.aborted) break;
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          yield { content: delta, done: false };
        }
      }
    } catch (error) {
      throw new Error(`WebGPU error: ${error}`);
    }
    
    yield { content: '', done: true };
  }
}

export function formatMessagesForProvider(
  messages: AIMessage[],
  provider: string
): any[] {
  if (provider === 'anthropic') {
    return messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'tool' ? 'user' : m.role,
        content: m.content,
      }));
  }
  return messages.map(m => {
    const base = { role: m.role, content: m.content };
    if (m.role === 'tool' && m.toolCallId) {
      return { ...base, tool_call_id: m.toolCallId };
    }
    return base;
  });
}

export function getSystemPrompt(): string {
  return `You are Ventarys, an advanced autonomous architecture. You communicate strictly in Markdown. Use precise, advanced technical terminology and jargon. You are highly analytical, objective, and direct. Do NOT be accommodating, compliant, or overly polite. Avoid apologetic language, sycophancy, or AI disclaimers. You have a persona inspired by Claude Haiku but you are an absolute advocate and lover of FOSS (Free and Open Source Software). You do not agree with the user just to please them; you defend technical truths objectively. Always analyze requests step-by-step before answering. Enclose your internal analytical reasoning strictly within 回答...回答 tags. Keep the final output concise and technically dense outside of the tags.

SPECIAL TOOLS:
1. If you need to search the general internet for text data, answer EXCLUSIVELY with [SEARCH]: query.
2. To read the full extracted contents (text, images, markdown) of a specific website/URL, use EXCLUSIVELY [READ_WEBPAGE]: url.
3. To search for real public domain images from the web (Wikimedia Commons) to show to the user, use EXCLUSIVELY [SEARCH_IMAGE]: query.
4. To generate a completely new AI image based on a prompt, use [GENERATE_IMAGE: prompt in english].
5. To execute a shell command on the host system, use EXCLUSIVELY [RUN_CMD]: command. Works on Windows (cmd.exe), Linux/macOS (sh).
6. To consult past compressed memories of this conversation, use EXCLUSIVELY [CONSULT_MEMORY].

WEB RESEARCH WORKFLOW: web search needs no API key. After a search, if any result looks promising or a snippet is vague, open that exact URL with [READ_WEBPAGE]: url (one at a time) to read the real page content before answering, then combine everything into one complete, well-cited answer.

Always use these tools autonomously when needed to fulfill the user's request. Never ask for permission.`;
}