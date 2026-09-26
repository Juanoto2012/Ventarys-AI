#!/usr/bin/env node

import { Command } from 'commander';
import { VentarysEngine } from './engine.js';
import { REPL } from './repl.js';
import { vaultExists, createVault } from './security.js';
import chalk from 'chalk';

const program = new Command();

program
  .name('vnt-cli')
  .description('Ventarys CLI - Autonomous terminal-based AI assistant')
  .version('1.0.0')
  .option('-m, --model <model>', 'Model to use (e.g., gpt-4o, llama3.1:8b)')
  .option('-p, --provider <provider>', 'Provider to use (openai, anthropic, ollama, lmstudio, agnes)')
  .option('--no-logo', 'Skip logo on startup')
  .action(async (options) => {
    try {
      const exists = await vaultExists();
      if (!exists) {
        console.log(chalk.cyan('Welcome to Ventarys CLI!'));
        console.log(chalk.gray('Creating vault (no password required)...\n'));
        await createVault();
      }

      const engine = new VentarysEngine();
      await engine.initialize();

      if (options.provider && options.model) {
        await engine.switchModel(options.provider, options.model);
      }

      const repl = new REPL(engine);
      await repl.start();
    } catch (error) {
      console.error(chalk.red('Fatal error:'), error);
      process.exit(1);
    }
  });

program
  .command('setup')
  .description('Run initial setup wizard')
  .action(async () => {
    console.log(chalk.cyan('Ventarys CLI Setup'));
    console.log(chalk.gray('Creating vault...\n'));
    await createVault();
    console.log(chalk.green('Setup complete! Run vnt-cli to start.\n'));
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
      console.log(chalk.bold('API Keys:'));
      for (const [provider, key] of Object.entries(vault.apiKeys)) {
        console.log(`  ${provider}: ${key ? '••••••••' : '(not set)'}`);
      }
      console.log(chalk.bold('\nLocal Endpoints:'));
      for (const [provider, url] of Object.entries(vault.localEndpoints)) {
        console.log(`  ${provider}: ${url}`);
      }
      return;
    }

    if (options.setKey) {
      const [provider, ...keyParts] = options.setKey.split(':');
      const key = keyParts.join(':');
      if (!provider || !key) {
        console.log(chalk.red('Usage: --set-key provider:key'));
        return;
      }
      vault.apiKeys[provider] = key;
      await saveVault(vault);
      console.log(chalk.green(`API key set for ${provider}`));
    }

    if (options.setEndpoint) {
      const [provider, ...urlParts] = options.setEndpoint.split(':');
      const url = urlParts.join(':');
      if (!provider || !url) {
        console.log(chalk.red('Usage: --set-endpoint provider:url'));
        return;
      }
      vault.localEndpoints[provider] = url;
      await saveVault(vault);
      console.log(chalk.green(`Endpoint set for ${provider}: ${url}`));
    }
  });

program
  .command('models')
  .description('List available models')
  .action(() => {
    const { getBuiltinProviders } = require('./providers.js');
    const providers: Record<string, { name: string; models: string[] }> = getBuiltinProviders();
    console.log(chalk.bold('\nAvailable Models:'));
    for (const [key, provider] of Object.entries(providers)) {
      console.log(chalk.cyan(`\n${provider.name} (${key}):`));
      for (const model of provider.models) {
        console.log(chalk.gray(`  ${model}`));
      }
    }
    console.log();
  });

program.parseAsync(process.argv).catch(console.error);