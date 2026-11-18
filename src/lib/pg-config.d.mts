import type { PoolConfig } from 'pg';
export declare class DatabaseConfigError extends Error {
  readonly code: string;
  constructor(code: string);
}
export declare function getPgOptions(env?: NodeJS.ProcessEnv): Pick<PoolConfig, 'connectionString' | 'ssl'>;
