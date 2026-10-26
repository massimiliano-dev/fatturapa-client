/** Output and environment of the CLI, injectable for tests. Nothing is written anywhere else. */
export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
  env: Record<string, string | undefined>;
  /** Current working directory, for default paths. */
  cwd: string;
}

export const ExitCode = { ok: 0, invalid: 1, error: 2 } as const;

export function processIo(): CliIo {
  return {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    env: process.env,
    cwd: process.cwd(),
  };
}
