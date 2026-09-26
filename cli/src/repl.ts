import * as readline from 'readline/promises';
import * as process from 'process';
import { VentarysEngine } from './engine.js';
import { marked } from 'marked';
import markedTerminal from 'marked-terminal';
import chalk from 'chalk';
import { VaultData } from './security.js';
import { getBuiltinProviders, fetchModels, AIProvider } from './providers.js';
import { select, text } from '@clack/prompts';

marked.setOptions({
  renderer: new markedTerminal() as any,
});

const DIM = chalk.gray;
const BOLD = chalk.bold;
const ACCENT = chalk.cyan;
const SUCCESS = chalk.green;
const WARNING = chalk.yellow;
const ERROR = chalk.red;

export class REPL {
  private engine: VentarysEngine;
  private rl: readline.Interface | null = null;
  private abortController: AbortController;
  private isGenerating = false;

  constructor(engine: VentarysEngine) {
    this.engine = engine;
    this.abortController = new AbortController();
  }

  private createReadline(): readline.Interface {
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

  async start(): Promise<void> {
    await this.engine.initialize();
    this.setupEngineCallbacks();
    this.createReadline();
    await this.printBanner();
    this.setupSignalHandlers();
    await this.runLoop();
  }

  private setupEngineCallbacks(): void {
    this.engine.setCallbacks({
      onChunk: (chunk: string) => {
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
      onToolStart: (tool: string, args: string) => {
        if (tool === 'RUN_CMD') {
          process.stdout.write(`\n${DIM('$ ')}${ACCENT(args)}${DIM('\n')}`);
        } else {
          process.stdout.write(`\n${DIM('[Tool: ')}${ACCENT(tool)}${DIM('] ')}`);
        }
      },
      onToolComplete: (result) => {
        if (result.tool === 'RUN_CMD') {
          if (result.result && result.result !== '(no output)') {
            process.stdout.write(`${result.result}\n`);
          }
          process.stdout.write(`${DIM('[exit ')}${result.success ? ACCENT('0') : ERROR(String(result.exitCode || 1))}${DIM(']')}\n`);
        } else {
          process.stdout.write(`\n${DIM('[Result: ')}${result.success ? ACCENT('OK') : ERROR('FAIL')}${DIM(']')}\n`);
        }
      },
    });
  }

  private async printBanner(): Promise<void> {
    console.clear();
    try {
      const fs = await import('fs/promises');
      const logo = await fs.readFile('logo.txt', 'utf8');
      console.log(DIM(logo));
    } catch {
      console.log(DIM('VENTARYS'));
    }
    console.log();
    console.log(ACCENT('  Ventarys') + DIM(' — Autonomous AI Assistant'));
    console.log(DIM('  Type ') + BOLD('/help') + DIM(' for commands, ') + BOLD('Ctrl+C') + DIM(' to interrupt'));
    console.log();
  }

  private setupSignalHandlers(): void {
    const handleInterrupt = () => {
      if (this.isGenerating) {
        this.abortController.abort();
        this.abortController = new AbortController();
        this.engine.setAbortSignal(this.abortController.signal);
        console.log(WARNING('\n⏻  Interrupted'));
        console.log();
        this.isGenerating = false;
        this.createReadline();
      } else {
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

  private async runLoop(): Promise<void> {
    while (true) {
      try {
        const input = await this.rl!.question(this.getPrompt());
        
        if (!input.trim()) continue;

        if (input.startsWith('/')) {
          await this.handleCommand(input.trim());
        } else {
          await this.sendMessage(input);
        }
      } catch (error) {
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

  private getPrompt(): string {
    const vault = this.engine.getVault();
    const model = vault?.settings.defaultModel || 'gpt-4o';
    const provider = vault?.settings.defaultProvider || 'openai';
    const providerName = provider === 'agnes' ? 'Agnes' : provider === 'custom' ? 'Custom' : provider;
    
    return `${DIM('┌ ')}${ACCENT(providerName)}${DIM('/')}${model}${DIM(' ❯ ')}${BOLD('You')}${DIM(' ')}`;
  }

  private async handleCommand(input: string): Promise<void> {
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

  private printHelp(): void {
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

  private async handleModelCommand(args: string[]): Promise<void> {
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

  private async listModels(): Promise<void> {
    const vault = this.engine.getVault();
    if (!vault) return;

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
      const models = await fetchModels(baseURL || 'https://apihub.agnes-ai.com/v1', apiKey);
      
      if (models.length === 0) {
        console.log(WARNING('  No models found'));
      } else {
        console.log();
        console.log(BOLD(`  Available models for ${provider}:`));
        console.log(DIM('  ────────────────────────────────────────'));
        for (const model of models) {
          const current = vault.settings.defaultModel === model ? ACCENT(' ← current') : '';
          console.log(`  ${model}${current}`);
        }
      }
    } catch (e) {
      console.log(ERROR(`  Failed to fetch models: ${e}`));
    }
    console.log();
  }

  private async handleAttach(filepath: string): Promise<void> {
    if (!filepath) {
      console.log(WARNING('  Usage: /attach <filepath>'));
      return;
    }
    try {
      await this.engine.addFileContext(filepath);
      console.log(SUCCESS(`  Attached: ${filepath}`));
    } catch (error) {
      console.log(ERROR(`  Failed to attach: ${error}`));
    }
    console.log();
  }

  private async handleConfig(): Promise<void> {
    const vault = this.engine.getVault();
    if (!vault) return;

    console.log();
    console.log(BOLD('  Configuration'));
    console.log(DIM('  ────────────────────────────────────────'));
    console.log(DIM('  API Keys:'));
    for (const [provider, key] of Object.entries(vault.apiKeys)) {
      const p = getBuiltinProviders()[provider];
      const label = p?.name || provider;
      console.log(`    ${label}: ${key ? DIM('••••••••') : WARNING('(not set)')}`);
    }
    console.log(DIM('  Endpoints:'));
    for (const [provider, url] of Object.entries(vault.localEndpoints)) {
      const p = getBuiltinProviders()[provider];
      const label = p?.name || provider;
      console.log(`    ${label}: ${url || DIM('(not set)')}`);
    }
    console.log();

    const choice = await select<string>({
      message: 'What would you like to configure?',
      options: [
        { value: 'api', label: 'Set API Key' },
        { value: 'endpoint', label: 'Set Endpoint URL' },
        { value: 'back', label: 'Back' },
      ],
    }) as string;

    if (choice === 'api') {
      const providers = Object.entries(getBuiltinProviders())
        .filter(([_, p]) => p.requiresApiKey)
        .map(([key, p]) => ({ value: key, label: p.name }));
      
      const provider = await select<string>({
        message: 'Select provider',
        options: providers,
      }) as string;
      
      const key = await text({ message: `Enter API key for ${provider}`, placeholder: 'sk-...' });
      vault.apiKeys[provider] = key as string;
      await this.saveVault(vault);
      console.log(SUCCESS('  API key saved'));
    } else if (choice === 'endpoint') {
      const providers = Object.entries(getBuiltinProviders())
        .map(([key, p]) => ({ value: key, label: p.name }));
      
      const provider = await select<string>({
        message: 'Select provider',
        options: providers,
      }) as string;
      
      const currentUrl = vault.localEndpoints[provider] || '';
      const url = await text({ message: `Enter endpoint URL for ${provider}`, placeholder: 'https://api.example.com/v1', initialValue: currentUrl });
      vault.localEndpoints[provider] = url as string;
      await this.saveVault(vault);
      console.log(SUCCESS('  Endpoint saved'));
    }
    console.log();
  }

  private async handleHistory(): Promise<void> {
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

    const choice = await select<string>({
      message: 'Select conversation to resume (or cancel)',
      options: [
        ...vault.chatHistory.slice(0, 10).map((s, i) => ({ value: String(i), label: s.title })),
        { value: 'cancel', label: 'Cancel' },
      ],
    }) as string;

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

  private async sendMessage(content: string): Promise<void> {
    await this.engine.addUserMessage(content);
    this.isGenerating = true;
    this.abortController = new AbortController();
    this.engine.setAbortSignal(this.abortController.signal);

    process.stdout.write(`${DIM('└ ')}${ACCENT('Ventarys')}${DIM(' ❯ ')}`);
    
    try {
      for await (const _chunk of this.engine.streamResponse()) {
        // Chunks are handled via callbacks
      }
    } catch (error) {
      if (error instanceof Error && !error.message.includes('Aborted')) {
        console.log(ERROR(`\n  Error: ${error.message}`));
        console.log();
      }
    } finally {
      this.isGenerating = false;
      console.log();
    }
  }

  private async continueGeneration(): Promise<void> {
    this.isGenerating = true;
    this.abortController = new AbortController();
    this.engine.setAbortSignal(this.abortController.signal);

    process.stdout.write(`${DIM('└ ')}${ACCENT('Ventarys')}${DIM(' ❯ ')}`);
    
    try {
      for await (const _chunk of this.engine.streamResponse()) {
        // Handled via callbacks
      }
    } catch (error) {
      if (error instanceof Error && !error.message.includes('Aborted')) {
        console.log(ERROR(`\n  Error: ${error.message}`));
        console.log();
      }
    } finally {
      this.isGenerating = false;
      console.log();
    }
  }

  private onComplete(fullResponse: string): void {
    // Response complete
  }

  private async saveVault(vault: VaultData): Promise<void> {
    const { saveVault } = await import('./security.js');
    await saveVault(vault);
  }
}