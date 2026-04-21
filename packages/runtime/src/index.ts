export * from "./audit.js";
export * from "./builds.js";
export * from "./commands.js";
export * from "./config.js";
export * from "./debug.js";
export * from "./deployments.js";
export * from "./detect.js";
export * from "./paths.js";
export * from "./ports.js";
export * from "./preflight.js";
export * from "./registry.js";
export * from "./releases.js";
export * from "./routes.js";
export * from "./status.js";

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};
