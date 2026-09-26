export interface VaultData {
    apiKeys: Record<string, string>;
    localEndpoints: Record<string, string>;
    chatHistory: ChatSession[];
    settings: VaultSettings;
    version: number;
}
export interface ChatSession {
    id: string;
    title: string;
    messages: ChatMessage[];
    createdAt: number;
    updatedAt: number;
    model: string;
    provider: string;
    memory?: string;
    isSummarizing?: boolean;
}
export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
}
export interface VaultSettings {
    defaultModel: string;
    defaultProvider: string;
    theme: string;
    autoSave: boolean;
}
export declare function ensureVaultDir(): Promise<void>;
export declare function vaultExists(): Promise<boolean>;
export declare function createVault(): Promise<VaultData>;
export declare function unlockVault(): Promise<VaultData>;
export declare function saveVault(vault: VaultData): Promise<void>;
export declare function updateVault(updates: Partial<VaultData>): Promise<VaultData>;
export declare function getVaultPath(): string;
//# sourceMappingURL=security.d.ts.map