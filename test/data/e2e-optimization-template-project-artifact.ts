import fs from "node:fs";
import path from "node:path";

/** 第 7 章串行用例复用的「优化建模模板」项目 UUID；与 `test-results/` 分离。 */
const ARTIFACT = path.join(
  import.meta.dirname,
  ".e2e-artifacts",
  "optimization-template-project-uuid.txt",
);

export function writeOptimizationTemplateProjectUuidArtifact(uuid: string): void {
  fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
  fs.writeFileSync(ARTIFACT, `${uuid.trim()}\n`, "utf8");
}

export function readOptimizationTemplateProjectUuidArtifact(): string | null {
  try {
    const u = fs.readFileSync(ARTIFACT, "utf8").trim();
    return u.length > 0 ? u : null;
  } catch {
    return null;
  }
}
