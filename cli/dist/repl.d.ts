import { VentarysEngine } from './engine.js';
export declare class REPL {
    private engine;
    private rl;
    private abortController;
    private isGenerating;
    constructor(engine: VentarysEngine);
    private createReadline;
    start(): Promise<void>;
    private setupEngineCallbacks;
    private printBanner;
    private setupSignalHandlers;
    private runLoop;
    private getPrompt;
    private handleCommand;
    private printHelp;
    private handleModelCommand;
    private listModels;
    private handleAttach;
    private handleConfig;
    private handleHistory;
    private sendMessage;
    private continueGeneration;
    private onComplete;
    private saveVault;
}
//# sourceMappingURL=repl.d.ts.map