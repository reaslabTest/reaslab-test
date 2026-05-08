import fs from "node:fs";
import path from "node:path";

/** 串行用例复用的定理证明（MIL）项目 UUID；与 `outputDir`（`test-results/`）分离，避免被 Playwright 清空。 */
const ARTIFACT = path.join(import.meta.dirname, ".e2e-artifacts", "theorem-project-uuid.txt");

export function clearTheoremProjectUuidArtifact(): void {
  try {
    fs.unlinkSync(ARTIFACT);
  } catch {
    /* ignore */
  }
}

export function writeTheoremProjectUuidArtifact(uuid: string): void {
  fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
  fs.writeFileSync(ARTIFACT, `${uuid.trim()}\n`, "utf8");
}

export function readTheoremProjectUuidArtifact(): string | null {
  try {
    const u = fs.readFileSync(ARTIFACT, "utf8").trim();
    return u.length > 0 ? u : null;
  } catch {
    return null;
  }
}
