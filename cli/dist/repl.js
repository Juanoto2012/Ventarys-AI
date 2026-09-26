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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.REPL = void 0;
const readline = __importStar(require("readline/promises"));
const process = __importStar(require("process"));
const marked_1 = require("marked");
const marked_terminal_1 = __importDefault(require("marked-terminal"));
const chalk_1 = __importDefault(require("chalk"));
const providers_js_1 = require("./providers.js");
const prompts_1 = require("@clack/prompts");
marked_1.marked.setOptions({
    renderer: new marked_terminal_1.default(),
});
const DIM = chalk_1.default.gray;
const BOLD = chalk_1.default.bold;
const ACCENT = chalk_1.default.cyan;
const SUCCESS = chalk_1.default.green;
const WARNING = chalk_1.default.yellow;
const ERROR = chalk_1.default.red;
class REPL {
    engine;
    rl = null;
    abortController;
    isGenerating = false;
    constructor(engine) {
        this.engine = engine;
        this.abortController = new AbortController();
    }
    createReadline() {
        if (this.rl) {
            this.rl.close();
        }
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: '',
            historySize: 1000,
        });
        return this.rl;
    }
    async start() {
        await this.engine.initialize();
        this.setupEngineCallbacks();
        this.createReadline();
        await this.printBanner();
        this.setupSignalHandlers();
        await this.runLoop();
    }
    setupEngineCallbacks() {
        this.engine.setCallbacks({
            onChunk: (chunk) => {
                const plain = chunk
                    .replace(/\*\*(.*?)\*\*/g, '$1')
                    .replace(/\*(.*?)\*/g, '$1')
                    .replace(/`(.*?)`/g, '$1')
                    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, ''))
                    .replace(/^#{1,6}\s+/gm, '')
                    .replace(/^\s*[-*+]\s+/gm, '')
                    .replace(/^\s*\d+\.\s+/gm, '')
                    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
                process.stdout.write(plain);
            },
            onToolStart: (tool, args) => {
                if (tool === 'RUN_CMD') {
                    process.stdout.write(`\n${DIM('$ ')}${ACCENT(args)}${DIM('\n')}`);
                }
                else {
                    process.stdout.write(`\n${DIM('[Tool: ')}${ACCENT(tool)}${DIM('] ')}`);
                }
            },
            onToolComplete: (result) => {
                if (result.tool === 'RUN_CMD') {
                    if (result.result && result.result !== '(no output)') {
                        process.stdout.write(`${result.result}\n`);
                    }
                    process.stdout.write(`${DIM('[exit ')}${result.success ? ACCENT('0') : ERROR(String(result.exitCode || 1))}${DIM(']')}\n`);
                }
                else {
                    process.stdout.write(`\n${DIM('[Result: ')}${result.success ? ACCENT('OK') : ERROR('FAIL')}${DIM(']')}\n`);
                }
            },
        });
    }
    async printBanner() {
        console.clear();
        try {
            const fs = await import('fs/promises');
            const logo = await fs.readFile('logo.txt', 'utf8');
            console.log(DIM(logo));
        }
        catch {
            console.log(DIM('VENTARYS'));
        }
        console.log();
        console.log(ACCENT('  Ventarys') + DIM(' — Autonomous AI Assistant'));
        console.log(DIM('  Type ') + BOLD('/help') + DIM(' for commands, ') + BOLD('Ctrl+C') + DIM(' to interrupt'));
        console.log();
    }
    setupSignalHandlers() {
        const handleInterrupt = () => {
            if (this.isGenerating) {
                this.abortController.abort();
                this.abortController = new AbortController();
                this.engine.setAbortSignal(this.abortController.signal);
                console.log(WARNING('\n⏻  Interrupted'));
                console.log();
                this.isGenerating = false;
                this.createReadline();
            }
            else {
                console.log(DIM('\n  Goodbye'));
                process.exit(0);
            }
        };
        // Use stdin keypress for cross-platform compatibility
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
            process.stdin.on('data', (chunk) => {
                if (chunk.length === 1 && chunk[0] === 3) { // Ctrl+C
                    handleInterrupt();
                }
            });
        }
    }
    async runLoop() {
        while (true) {
            try {
                const input = await this.rl.question(this.getPrompt());
                if (!input.trim())
                    continue;
                if (input.startsWith('/')) {
                    await this.handleCommand(input.trim());
                }
                else {
                    await this.sendMessage(input);
                }
            }
            catch (error) {
                if (error instanceof Error && error.message.includes('Aborted')) {
                    continue;
                }
                if (error instanceof Error && error.message.includes('readline')) {
                    this.createReadline();
                    continue;
                }
                console.log(ERROR(`  Error: ${error}`));
                console.log();
            }
        }
    }
    getPrompt() {
        const vault = this.engine.getVault();
        const model = vault?.settings.defaultModel || 'gpt-4o';
        const provider = vault?.settings.defaultProvider || 'openai';
        const providerName = provider === 'agnes' ? 'Agnes' : provider === 'custom' ? 'Custom' : provider;
        return `${DIM('┌ ')}${ACCENT(providerName)}${DIM('/')}${model}${DIM(' ❯ ')}${BOLD('You')}${DIM(' ')}`;
    }
    async handleCommand(input) {
        const [cmd, ...args] = input.slice(1).split(' ');
        switch (cmd) {
            case 'help':
                this.printHelp();
                break;
            case 'model':
                await this.handleModelCommand(args);
                break;
            case 'models':
                await this.listModels();
                break;
            case 'attach':
                await this.handleAttach(args.join(' '));
                break;
            case 'config':
                await this.handleConfig();
                break;
            case 'clear':
                this.engine.clearHistory();
                console.log(SUCCESS('  Conversation cleared'));
                console.log();
                break;
            case 'history':
                await this.handleHistory();
                break;
            case 'save':
                console.log(SUCCESS('  Conversation saved'));
                console.log();
                break;
            case 'exit':
            case 'quit':
                console.log(DIM('  Goodbye'));
                process.exit(0);
            default:
                console.log(ERROR(`  Unknown command: ${cmd}. Type /help for help.`));
                console.log();
        }
        this.createReadline();
    }
    printHelp() {
        console.log();
        console.log(BOLD('  Commands:'));
        console.log(DIM('  ────────────────────────────────────────'));
        console.log(`  ${BOLD('/help')}              ${DIM('Show this help')}`);
        console.log(`  ${BOLD('/model <provider> <model>')}  ${DIM('Switch model (e.g., /model agnes agnes-7b)')}`);
        console.log(`  ${BOLD('/models')}            ${DIM('Fetch and list available models from provider')}`);
        console.log(`  ${BOLD('/attach <file>')}     ${DIM('Attach file to context')}`);
        console.log(`  ${BOLD('/config')}            ${DIM('Manage API keys and endpoints')}`);
        console.log(`  ${BOLD('/clear')}             ${DIM('Start new conversation')}`);
        console.log(`  ${BOLD('/history')}           ${DIM('List and resume past conversations')}`);
        console.log(`  ${BOLD('/save')}              ${DIM('Save current conversation')}`);
        console.log(`  ${BOLD('/exit')}              ${DIM('Exit Ventarys')}`);
        console.log();
    }
    async handleModelCommand(args) {
        if (args.length < 2) {
            console.log(WARNING('  Usage: /model <provider> <model>'));
            console.log();
            return;
        }
        const [provider, ...modelParts] = args;
        const model = modelParts.join(' ');
        await this.engine.switchModel(provider, model);
        console.log(SUCCESS(`  Switched to ${provider}/${model}`));
        console.log();
    }
    async listModels() {
        const vault = this.engine.getVault();
        if (!vault)
            return;
        const provider = vault.settings.defaultProvider;
        const apiKey = vault.apiKeys[provider];
        const baseURL = vault.localEndpoints[provider];
        if (!baseURL && provider !== 'agnes') {
            console.log(WARNING('  No endpoint configured for this provider'));
            console.log();
            return;
        }
        console.log(DIM('  Fetching models...'));
        try {
            const models = await (0, providers_js_1.fetchModels)(baseURL || 'https://apihub.agnes-ai.com/v1', apiKey);
            if (models.length === 0) {
                console.log(WARNING('  No models found'));
            }
            else {
                console.log();
                console.log(BOLD(`  Available models for ${provider}:`));
                console.log(DIM('  ────────────────────────────────────────'));
                for (const model of models) {
                    const current = vault.settings.defaultModel === model ? ACCENT(' ← current') : '';
                    console.log(`  ${model}${current}`);
                }
            }
        }
        catch (e) {
            console.log(ERROR(`  Failed to fetch models: ${e}`));
        }
        console.log();
    }
    async handleAttach(filepath) {
        if (!filepath) {
            console.log(WARNING('  Usage: /attach <filepath>'));
            return;
        }
        try {
            await this.engine.addFileContext(filepath);
            console.log(SUCCESS(`  Attached: ${filepath}`));
        }
        catch (error) {
            console.log(ERROR(`  Failed to attach: ${error}`));
        }
        console.log();
    }
    async handleConfig() {
        const vault = this.engine.getVault();
        if (!vault)
            return;
        console.log();
        console.log(BOLD('  Configuration'));
        console.log(DIM('  ────────────────────────────────────────'));
        console.log(DIM('  API Keys:'));
        for (const [provider, key] of Object.entries(vault.apiKeys)) {
            const p = (0, providers_js_1.getBuiltinProviders)()[provider];
            const label = p?.name || provider;
            console.log(`    ${label}: ${key ? DIM('••••••••') : WARNING('(not set)')}`);
        }
        console.log(DIM('  Endpoints:'));
        for (const [provider, url] of Object.entries(vault.localEndpoints)) {
            const p = (0, providers_js_1.getBuiltinProviders)()[provider];
            const label = p?.name || provider;
            console.log(`    ${label}: ${url || DIM('(not set)')}`);
        }
        console.log();
        const choice = await (0, prompts_1.select)({
            message: 'What would you like to configure?',
            options: [
                { value: 'api', label: 'Set API Key' },
                { value: 'endpoint', label: 'Set Endpoint URL' },
                { value: 'back', label: 'Back' },
            ],
        });
        if (choice === 'api') {
            const providers = Object.entries((0, providers_js_1.getBuiltinProviders)())
                .filter(([_, p]) => p.requiresApiKey)
                .map(([key, p]) => ({ value: key, label: p.name }));
            const provider = await (0, prompts_1.select)({
                message: 'Select provider',
                options: providers,
            });
            const key = await (0, prompts_1.text)({ message: `Enter API key for ${provider}`, placeholder: 'sk-...' });
            vault.apiKeys[provider] = key;
            await this.saveVault(vault);
            console.log(SUCCESS('  API key saved'));
        }
        else if (choice === 'endpoint') {
            const providers = Object.entries((0, providers_js_1.getBuiltinProviders)())
                .map(([key, p]) => ({ value: key, label: p.name }));
            const provider = await (0, prompts_1.select)({
                message: 'Select provider',
                options: providers,
            });
            const currentUrl = vault.localEndpoints[provider] || '';
            const url = await (0, prompts_1.text)({ message: `Enter endpoint URL for ${provider}`, placeholder: 'https://api.example.com/v1', initialValue: currentUrl });
            vault.localEndpoints[provider] = url;
            await this.saveVault(vault);
            console.log(SUCCESS('  Endpoint saved'));
        }
        console.log();
    }
    async handleHistory() {
        const vault = this.engine.getVault();
        if (!vault || vault.chatHistory.length === 0) {
            console.log(DIM('  No conversation history'));
            console.log();
            return;
        }
        console.log();
        console.log(BOLD('  Conversation History'));
        console.log(DIM('  ────────────────────────────────────────'));
        vault.chatHistory.forEach((session, i) => {
            const date = new Date(session.updatedAt).toLocaleString();
            console.log(`  ${DIM(String(i + 1).padStart(2))}  ${session.title} ${DIM(`(${session.provider}/${session.model}) — ${date}`)}`);
        });
        console.log();
        const choice = await (0, prompts_1.select)({
            message: 'Select conversation to resume (or cancel)',
            options: [
                ...vault.chatHistory.slice(0, 10).map((s, i) => ({ value: String(i), label: s.title })),
                { value: 'cancel', label: 'Cancel' },
            ],
        });
        if (choice !== 'cancel') {
            const session = vault.chatHistory[parseInt(choice)];
            this.engine.clearHistory();
            for (const msg of session.messages) {
                this.engine.getMessages().push({ role: msg.role, content: msg.content });
            }
            await this.engine.switchModel(session.provider, session.model);
            console.log(SUCCESS(`  Resumed: ${session.title}`));
        }
        console.log();
    }
    async sendMessage(content) {
        await this.engine.addUserMessage(content);
        this.isGenerating = true;
        this.abortController = new AbortController();
        this.engine.setAbortSignal(this.abortController.signal);
        process.stdout.write(`${DIM('└ ')}${ACCENT('Ventarys')}${DIM(' ❯ ')}`);
        try {
            for await (const _chunk of this.engine.streamResponse()) {
                // Chunks are handled via callbacks
            }
        }
        catch (error) {
            if (error instanceof Error && !error.message.includes('Aborted')) {
                console.log(ERROR(`\n  Error: ${error.message}`));
                console.log();
            }
        }
        finally {
            this.isGenerating = false;
            console.log();
        }
    }
    async continueGeneration() {
        this.isGenerating = true;
        this.abortController = new AbortController();
        this.engine.setAbortSignal(this.abortController.signal);
        process.stdout.write(`${DIM('└ ')}${ACCENT('Ventarys')}${DIM(' ❯ ')}`);
        try {
            for await (const _chunk of this.engine.streamResponse()) {
                // Handled via callbacks
            }
        }
        catch (error) {
            if (error instanceof Error && !error.message.includes('Aborted')) {
                console.log(ERROR(`\n  Error: ${error.message}`));
                console.log();
            }
        }
        finally {
            this.isGenerating = false;
            console.log();
        }
    }
    onComplete(fullResponse) {
        // Response complete
    }
    async saveVault(vault) {
        const { saveVault } = await import('./security.js');
        await saveVault(vault);
    }
}
exports.REPL = REPL;
//# sourceMappingURL=repl.js.map