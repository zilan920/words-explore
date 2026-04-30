declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(location: string);
    close(): void;
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
  }

  export class StatementSync {
    all(...args: unknown[]): Array<Record<string, unknown>>;
    get(...args: unknown[]): Record<string, unknown> | undefined;
    run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  }
}
