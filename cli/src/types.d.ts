declare module 'marked-terminal' {
  import { Renderer } from 'marked';
  class MarkedTerminal extends Renderer {
    constructor(options?: any);
  }
  export = MarkedTerminal;
}

declare module 'ora' {
  interface Ora {
    start(): Ora;
    succeed(text?: string): Ora;
    fail(text?: string): Ora;
    stop(): Ora;
  }
  interface OraOptions {
    text?: string;
    color?: string;
    spinner?: string | { frames: string[]; interval: number };
  }
  function ora(options?: string | OraOptions): Ora;
  export = ora;
}