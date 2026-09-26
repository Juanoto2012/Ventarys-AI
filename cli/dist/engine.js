"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.VentarysEngine = void 0;
const providers_js_1 = require("./providers.js");
const security_js_1 = require("./security.js");
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const TOOL_PATTERNS = {
    search: /\[SEARCH\]:\s*([^\]\n]+)/gi,
    readWebpage: /\[READ_WEBPAGE\]:\s*(https?:\/\/[^\s\]\n]+)/gi,
    searchImage: /\[SEARCH_IMAGE\]:\s*([^\]\n]+)/gi,
    runCmd: /\[RUN_CMD\s*\]:\s*(.+)/gi,
    generateImage: /\[GENERATE_IMAGE\s*:\s*([^\n\]]+)\]|\[GENERATE_IMAGE\]\s*:\s*([^\n\]]+)/gi,
    consultMemory: /\[CONSULT_MEMORY\]/gi,
};
class VentarysEngine {
    engine;
    vault = null;
    messages = [];
    abortSignal = null;
    onToolStart;
    onToolComplete;
    onChunk;
    onComplete;
    currentChatId = null;
    constructor() {
        this.engine = new providers_js_1.AIEngine({ provider: 'agnes', model: 'gpt-4o' });
    }
    async initialize() {
        this.vault = await (0, security_js_1.unlockVault)();
        const { defaultModel, defaultProvider } = this.vault.settings;
        const providerInfo = (0, providers_js_1.getProvider)(defaultProvider);
        const baseURL = this.vault.localEndpoints[defaultProvider] || providerInfo?.baseURL;
        this.engine.setConfig({
            provider: defaultProvider,
            model: defaultModel,
            apiKey: this.vault.apiKeys[defaultProvider],
            baseURL,
        });
        this.messages = [
            { role: 'system', content: (0, providers_js_1.getSystemPrompt)() },
        ];
    }
    setCallbacks(callbacks) {
        this.onToolStart = callbacks.onToolStart;
        this.onToolComplete = callbacks.onToolComplete;
        this.onChunk = callbacks.onChunk;
        this.onComplete = callbacks.onComplete;
    }
    setAbortSignal(signal) {
        this.abortSignal = signal;
    }
    async switchModel(provider, model) {
        if (!this.vault)
            await this.initialize();
        const providerInfo = (0, providers_js_1.getProvider)(provider);
        const apiKey = this.vault?.apiKeys[provider];
        const baseURL = this.vault?.localEndpoints[provider] || providerInfo?.baseURL;
        this.engine.setConfig({ provider, model, apiKey, baseURL });
        if (this.vault) {
            this.vault.settings.defaultProvider = provider;
            this.vault.settings.defaultModel = model;
            await (0, security_js_1.saveVault)(this.vault);
        }
    }
    async addUserMessage(content) {
        this.messages.push({ role: 'user', content });
    }
    async addSystemMessage(content) {
        this.messages.push({ role: 'system', content });
    }
    async addFileContext(filepath) {
        try {
            const content = await fs.readFile(filepath, 'utf8');
            this.messages.push({
                role: 'system',
                content: `--- File: ${filepath} ---\n${content}\n--- End File ---`,
            });
        }
        catch (error) {
            throw new Error(`Failed to read file: ${error}`);
        }
    }
    async *streamResponse() {
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
    extractTools(text) {
        const tools = [];
        for (const [name, pattern] of Object.entries(TOOL_PATTERNS)) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                let args = '';
                if (name === 'generateImage') {
                    args = (match[1] || match[2] || '').trim();
                }
                else {
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
    async executeTool(name, args) {
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
    async executeSearch(query) {
        try {
            const results = await this.performWebSearch(query);
            if (results.length === 0) {
                return { tool: 'SEARCH', args: query, result: 'No results found', success: true };
            }
            const formatted = results.map((r, i) => `${i + 1}. ${r.title}\n   URL: ${r.url}\n   Snippet: ${r.content}`).join('\n\n');
            return { tool: 'SEARCH', args: query, result: formatted, success: true };
        }
        catch (error) {
            return { tool: 'SEARCH', args: query, result: `Search failed: ${error}`, success: false };
        }
    }
    async performWebSearch(query) {
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
                if (!response.ok)
                    continue;
                const data = await response.json();
                if (data && Array.isArray(data.results) && data.results.length > 0) {
                    return data.results.slice(0, 5).map((r) => ({
                        title: r.title || 'Untitled',
                        url: r.url || '',
                        content: (r.content || '').substring(0, 500)
                    }));
                }
            }
            catch {
                continue;
            }
        }
        try {
            const fallback = await this.performJinaSearch(query);
            if (fallback.length > 0)
                return fallback;
        }
        catch { }
        throw new Error("No results from any search instance");
    }
    async performJinaSearch(query) {
        try {
            const response = await fetch(`https://s.jina.ai/${encodeURIComponent(query)}`, {
                headers: { 'Accept': 'application/json' }
            });
            if (!response.ok)
                throw new Error("Jina search failed");
            const data = await response.json();
            if (data.data && Array.isArray(data.data)) {
                return data.data.slice(0, 5).map((r) => ({
                    title: r.title || 'Untitled',
                    url: r.url || '',
                    content: (r.content || '').substring(0, 500)
                }));
            }
        }
        catch { }
        return [];
    }
    async executeReadWebpage(url) {
        try {
            const response = await fetch(`https://r.jina.ai/${encodeURIComponent(url)}`, {
                headers: { 'Accept': 'text/event-stream', 'X-Return-Format': 'markdown' }
            });
            if (!response.ok)
                throw new Error("Jina AI reader failed");
            const text = await response.text();
            return { tool: 'READ_WEBPAGE', args: url, result: text.substring(0, 15000), success: true };
        }
        catch (error) {
            return { tool: 'READ_WEBPAGE', args: url, result: `Read failed: ${error}`, success: false };
        }
    }
    async executeSearchImage(query) {
        try {
            const images = await this.performWikiImageSearch(query);
            if (images.length === 0) {
                return { tool: 'SEARCH_IMAGE', args: query, result: 'No free images found', success: true };
            }
            const formatted = images.map((img, i) => `${i + 1}. ${img.title}\n   Image: ${img.url}\n   Page: ${img.pageUrl}`).join('\n\n');
            return { tool: 'SEARCH_IMAGE', args: query, result: formatted, success: true };
        }
        catch (error) {
            return { tool: 'SEARCH_IMAGE', args: query, result: `Image search failed: ${error}`, success: false };
        }
    }
    async performWikiImageSearch(query) {
        try {
            const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages|info&inprop=url&generator=search&gsrsearch=${encodeURIComponent(query)}&pithumbsize=800&origin=*`;
            const response = await fetch(url);
            const data = await response.json();
            if (data.query && data.query.pages) {
                const pages = Object.values(data.query.pages);
                const withImages = pages.filter(p => p.thumbnail);
                if (withImages.length > 0) {
                    return withImages.slice(0, 3).map(p => ({
                        title: p.title,
                        url: p.thumbnail.source,
                        pageUrl: p.fullurl
                    }));
                }
            }
        }
        catch { }
        return [];
    }
    async executeRunCmd(command) {
        const isWindows = process.platform === 'win32';
        const shell = isWindows ? 'cmd.exe' : 'sh';
        const args = isWindows ? ['/c', command] : ['-c', command];
        return new Promise((resolve) => {
            const proc = (0, child_process_1.spawn)(shell, args, {
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
    async executeGenerateImage(prompt) {
        try {
            const apiKey = this.vault?.apiKeys.agnes;
            if (!apiKey) {
                return { tool: 'GENERATE_IMAGE', args: prompt, result: 'Image generation requires an Agnes AI API key', success: false };
            }
            const outputDir = path.join(process.cwd(), 'ventarys_outputs');
            await fs.mkdir(outputDir, { recursive: true });
            const endpoint = 'https://apihub.agnes-ai.com/v1/images/generations';
            const imageModel = globalThis.currentImageModelId || 'flux';
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
            const data = await response.json();
            let finalImgUrl = "", base64Data = null;
            if (data.data && data.data.length > 0) {
                if (data.data[0].b64_json)
                    base64Data = "data:image/png;base64," + data.data[0].b64_json;
                else if (data.data[0].url)
                    finalImgUrl = data.data[0].url;
            }
            else if (data.url)
                finalImgUrl = data.url;
            else if (data.success && data.result && data.result.url)
                finalImgUrl = data.result.url;
            else
                throw new Error("Invalid response format");
            const finalImageSrc = base64Data ? base64Data : finalImgUrl;
            if (base64Data) {
                const filename = `generated_${Date.now()}.png`;
                const filepath = path.join(outputDir, filename);
                const buffer = Buffer.from(base64Data.split(',')[1], 'base64');
                await fs.writeFile(filepath, buffer);
                return { tool: 'GENERATE_IMAGE', args: prompt, result: `Image saved to: ${filepath}`, success: true };
            }
            return { tool: 'GENERATE_IMAGE', args: prompt, result: finalImageSrc, success: true };
        }
        catch (error) {
            return { tool: 'GENERATE_IMAGE', args: prompt, result: `Generation failed: ${error}`, success: false };
        }
    }
    async executeConsultMemory() {
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
    async saveConversation() {
        if (!this.vault || !this.currentChatId)
            return;
        const session = this.vault.chatHistory.find(c => c.id === this.currentChatId);
        if (!session)
            return;
        session.messages = this.messages
            .filter(m => m.role !== 'system')
            .map(m => ({
            role: m.role,
            content: m.content,
            timestamp: Date.now(),
        }));
        session.updatedAt = Date.now();
        await (0, security_js_1.saveVault)(this.vault);
    }
    async compactConversation(chatId) {
        if (!this.vault)
            return;
        const chat = this.vault.chatHistory.find(c => c.id === chatId);
        if (!chat || !chat.messages.length || chat.messages.length <= 15)
            return;
        const msgsToCompact = chat.messages.slice(0, chat.messages.length - 6);
        if (msgsToCompact.length < 5)
            return;
        const textToCompact = msgsToCompact.map(m => `${m.role}: ${m.content}`).join('\n');
        const prompt = `As Ventarys, your task is to heavily compress and summarize this past conversation segment. Retain ALL crucial facts, your FOSS principles, code snippets, architectural decisions, and user preferences. Drop pleasantries.

Old Memory Summary: ${chat.memory || 'None'}

New Conversation Segment to Compress:
${textToCompact}`;
        try {
            const tempEngine = new providers_js_1.AIEngine(this.engine.config);
            let summaryText = '';
            for await (const chunk of tempEngine.streamChat([{ role: 'user', content: prompt }])) {
                summaryText += chunk.content;
            }
            if (summaryText.length > 50) {
                chat.memory = summaryText;
                chat.messages.splice(0, msgsToCompact.length);
                await (0, security_js_1.saveVault)(this.vault);
            }
        }
        catch (e) {
            // Silently fail
        }
    }
    getMessages() {
        return [...this.messages];
    }
    getVault() {
        return this.vault;
    }
    clearHistory() {
        this.messages = [{ role: 'system', content: (0, providers_js_1.getSystemPrompt)() }];
    }
    setCurrentChatId(id) {
        this.currentChatId = id;
    }
}
exports.VentarysEngine = VentarysEngine;
//# sourceMappingURL=engine.js.map