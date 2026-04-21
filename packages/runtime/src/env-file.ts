import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const quoteEnvValue = (value: string): string => {
  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) {
    return value;
  }

  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
};

const renderEnvLine = (key: string, value: string | undefined): string | null => {
  if (value === undefined) {
    return null;
  }

  return `${key}=${quoteEnvValue(value)}`;
};

export const updateEnvFile = async (
  path: string,
  values: Record<string, string | undefined>,
): Promise<void> => {
  const existing = await readFile(path, "utf8").catch(() => "");
  const seen = new Set<string>();
  const updatedLines = existing
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => {
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);

      if (!match?.[1] || !(match[1] in values)) {
        return line;
      }

      seen.add(match[1]);
      return renderEnvLine(match[1], values[match[1]]);
    })
    .filter((line): line is string => line !== null);

  for (const [key, value] of Object.entries(values)) {
    if (seen.has(key)) {
      continue;
    }

    const line = renderEnvLine(key, value);

    if (line) {
      updatedLines.push(line);
    }
  }

  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, `${updatedLines.join("\n")}\n`, "utf8");
  await chmod(tmpPath, 0o600);
  await rename(tmpPath, path);
};
