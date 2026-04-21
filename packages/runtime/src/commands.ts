import { execFile } from "node:child_process";

export type RuntimeCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type RunCommandOptions = {
  timeoutMs?: number;
  cwd?: string;
  maxBuffer?: number;
};

type ExecFileError = Error & {
  code?: number | string;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
};

const toText = (value: string | Buffer | undefined): string => {
  if (value === undefined) {
    return "";
  }

  return Buffer.isBuffer(value) ? value.toString("utf8") : value;
};

const exitCodeFromError = (error: ExecFileError): number => {
  if (typeof error.code === "number") {
    return error.code;
  }

  return 1;
};

export const runCommand = async (
  command: string,
  args: string[] = [],
  optionsOrTimeoutMs: RunCommandOptions | number = 10_000,
): Promise<RuntimeCommandResult> => {
  const options =
    typeof optionsOrTimeoutMs === "number"
      ? { timeoutMs: optionsOrTimeoutMs }
      : optionsOrTimeoutMs;

  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        timeout: options.timeoutMs ?? 10_000,
        cwd: options.cwd,
        windowsHide: true,
        maxBuffer: options.maxBuffer ?? 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const execError = error as ExecFileError;

          resolve({
            exitCode: exitCodeFromError(execError),
            stdout: toText(execError.stdout) || toText(stdout),
            stderr: toText(execError.stderr) || toText(stderr) || error.message,
          });
          return;
        }

        resolve({
          exitCode: 0,
          stdout: toText(stdout),
          stderr: toText(stderr),
        });
      },
    );
  });
};

export const commandExists = async (command: string): Promise<boolean> => {
  const probe =
    process.platform === "win32"
      ? await runCommand("where.exe", [command], 5_000)
      : await runCommand("sh", ["-lc", `command -v ${command}`], 5_000);

  return probe.exitCode === 0 && probe.stdout.trim().length > 0;
};
