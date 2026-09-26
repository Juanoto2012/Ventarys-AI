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
export declare function getBuiltinProviders(): Record<string, AIProvider>;
export declare function getProvider(key: string): AIProvider | undefined;
declare const WEBGPU_MODELS: {
    id: string;
    name: string;
    f32: boolean;
}[];
export declare function getWebGPUModels(): typeof WEBGPU_MODELS;
export declare function fetchModels(baseURL: string, apiKey?: string): Promise<string[]>;
export declare class AIEngine {
    private configValue;
    private abortController;
    private webllmModule;
    private webgpuEngine;
    constructor(config: ProviderConfig);
    get config(): ProviderConfig;
    setConfig(config: ProviderConfig): void;
    abort(): void;
    streamChat(messages: AIMessage[]): AsyncGenerator<ChatCompletionChunk>;
    private streamWebGPU;
}
export declare function formatMessagesForProvider(messages: AIMessage[], provider: string): any[];
export declare function getSystemPrompt(): string;
export {};
//# sourceMappingURL=providers.d.ts.map