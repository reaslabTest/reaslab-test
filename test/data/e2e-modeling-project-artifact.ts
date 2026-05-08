import fs from "node:fs";
import path from "node:path";

/** 第 5 章串行用例复用的数学建模项目 UUID；与 `test-results/` 分离，避免被 Playwright 清空。 */
const ARTIFACT = path.join(import.meta.dirname, ".e2e-artifacts", "modeling-project-uuid.txt");

export function clearModelingProjectUuidArtifact(): void {
  try {
    fs.unlinkSync(ARTIFACT);
  } catch {
    /* ignore */
  }
}

export function writeModelingProjectUuidArtifact(uuid: string): void {
  fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
  fs.writeFileSync(ARTIFACT, `${uuid.trim()}\n`, "utf8");
}

export function readModelingProjectUuidArtifact(): string | null {
  try {
    const u = fs.readFileSync(ARTIFACT, "utf8").trim();
    return u.length > 0 ? u : null;
  } catch {
    return null;
  }
}
