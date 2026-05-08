import fs from "node:fs";
import path from "node:path";

/**
 * Playground 串联用例在「新建项目」步骤写入，供人工复现或后续脚本读取；**不可**放在 `outputDir`（`test-results/`）下，否则会被 Playwright 清空。
 */
const ARTIFACT = path.join(import.meta.dirname, ".e2e-artifacts", "playground-project-uuid.txt");

export function clearPlaygroundProjectUuidArtifact(): void {
  try {
    fs.unlinkSync(ARTIFACT);
  } catch {
    /* ignore */
  }
}

export function writePlaygroundProjectUuidArtifact(uuid: string): void {
  fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
  fs.writeFileSync(ARTIFACT, `${uuid.trim()}\n`, "utf8");
}

export function readPlaygroundProjectUuidArtifact(): string | null {
  try {
    const u = fs.readFileSync(ARTIFACT, "utf8").trim();
    return u.length > 0 ? u : null;
  } catch {
    return null;
  }
}
