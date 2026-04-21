export * from "./paths.js";
export * from "./routes.js";
export * from "./status.js";

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};
