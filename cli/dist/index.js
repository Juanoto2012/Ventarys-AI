#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const engine_js_1 = require("./engine.js");
const repl_js_1 = require("./repl.js");
const security_js_1 = require("./security.js");
const chalk_1 = __importDefault(require("chalk"));
const program = new commander_1.Command();
program
    .name('vnt-cli')
    .description('Ventarys CLI - Autonomous terminal-based AI assistant')
    .version('1.0.0')
    .option('-m, --model <model>', 'Model to use (e.g., gpt-4o, llama3.1:8b)')
    .option('-p, --provider <provider>', 'Provider to use (openai, anthropic, ollama, lmstudio, agnes)')
    .option('--no-logo', 'Skip logo on startup')
    .action(async (options) => {
    try {
        const exists = await (0, security_js_1.vaultExists)();
        if (!exists) {
            console.log(chalk_1.default.cyan('Welcome to Ventarys CLI!'));
            console.log(chalk_1.default.gray('Creating vault (no password required)...\n'));
            await (0, security_js_1.createVault)();
        }
        const engine = new engine_js_1.VentarysEngine();
        await engine.initialize();
        if (options.provider && options.model) {
            await engine.switchModel(options.provider, options.model);
        }
        const repl = new repl_js_1.REPL(engine);
        await repl.start();
    }
    catch (error) {
        console.error(chalk_1.default.red('Fatal error:'), error);
        process.exit(1);
    }
});
program
    .command('setup')
    .description('Run initial setup wizard')
    .action(async () => {
    console.log(chalk_1.default.cyan('Ventarys CLI Setup'));
    console.log(chalk_1.default.gray('Creating vault...\n'));
    await (0, security_js_1.createVault)();
    console.log(chalk_1.default.green('Setup complete! Run vnt-cli to start.\n'));
});
program
    .command('config')
    .description('Manage configuration')
    .option('--set-key <key>', 'Set API key for provider (format: provider:key)')
    .option('--set-endpoint <endpoint>', 'Set local endpoint for provider (format: provider:url)')
    .option('--list', 'List current configuration')
    .action(async (options) => {
    const { unlockVault, saveVault } = await import('./security.js');
    const vault = await unlockVault();
    if (options.list) {
        console.log(chalk_1.default.bold('API Keys:'));
        for (const [provider, key] of Object.entries(vault.apiKeys)) {
            console.log(`  ${provider}: ${key ? '••••••••' : '(not set)'}`);
        }
        console.log(chalk_1.default.bold('\nLocal Endpoints:'));
        for (const [provider, url] of Object.entries(vault.localEndpoints)) {
            console.log(`  ${provider}: ${url}`);
        }
        return;
    }
    if (options.setKey) {
        const [provider, ...keyParts] = options.setKey.split(':');
        const key = keyParts.join(':');
        if (!provider || !key) {
            console.log(chalk_1.default.red('Usage: --set-key provider:key'));
            return;
        }
        vault.apiKeys[provider] = key;
        await saveVault(vault);
        console.log(chalk_1.default.green(`API key set for ${provider}`));
    }
    if (options.setEndpoint) {
        const [provider, ...urlParts] = options.setEndpoint.split(':');
        const url = urlParts.join(':');
        if (!provider || !url) {
            console.log(chalk_1.default.red('Usage: --set-endpoint provider:url'));
            return;
        }
        vault.localEndpoints[provider] = url;
        await saveVault(vault);
        console.log(chalk_1.default.green(`Endpoint set for ${provider}: ${url}`));
    }
});
program
    .command('models')
    .description('List available models')
    .action(() => {
    const { getBuiltinProviders } = require('./providers.js');
    const providers = getBuiltinProviders();
    console.log(chalk_1.default.bold('\nAvailable Models:'));
    for (const [key, provider] of Object.entries(providers)) {
        console.log(chalk_1.default.cyan(`\n${provider.name} (${key}):`));
        for (const model of provider.models) {
            console.log(chalk_1.default.gray(`  ${model}`));
        }
    }
    console.log();
});
program.parseAsync(process.argv).catch(console.error);
//# sourceMappingURL=index.js.map