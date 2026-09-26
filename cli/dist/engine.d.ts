import { AIMessage } from './providers.js';
import { VaultData } from './security.js';
export interface ToolResult {
    tool: string;
    args: string;
    result: string;
    success: boolean;
    exitCode?: number;
}
export declare class VentarysEngine {
    private engine;
    private vault;
    private messages;
    private abortSignal;
    private onToolStart?;
    private onToolComplete?;
    private onChunk?;
    private onComplete?;
    private currentChatId;
    constructor();
    initialize(): Promise<void>;
    setCallbacks(callbacks: {
        onToolStart?: (tool: string, args: string) => void;
        onToolComplete?: (result: ToolResult) => void;
        onChunk?: (chunk: string) => void;
        onComplete?: (fullResponse: string) => void;
    }): void;
    setAbortSignal(signal: AbortSignal): void;
    switchModel(provider: string, model: string): Promise<void>;
    addUserMessage(content: string): Promise<void>;
    addSystemMessage(content: string): Promise<void>;
    addFileContext(filepath: string): Promise<void>;
    streamResponse(): AsyncGenerator<string>;
    private extractTools;
    private executeTool;
    private executeSearch;
    private performWebSearch;
    private performJinaSearch;
    private executeReadWebpage;
    private executeSearchImage;
    private performWikiImageSearch;
    private executeRunCmd;
    private executeGenerateImage;
    private executeConsultMemory;
    private saveConversation;
    compactConversation(chatId: string): Promise<void>;
    getMessages(): AIMessage[];
    getVault(): VaultData | null;
    clearHistory(): void;
    setCurrentChatId(id: string): void;
}
//# sourceMappingURL=engine.d.ts.map