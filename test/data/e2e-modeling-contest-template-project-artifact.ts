import fs from "node:fs";
import path from "node:path";

/** 第 9 章串行用例复用的「数学建模竞赛模板」项目 UUID；与 `test-results/` 分离。 */
const ARTIFACT = path.join(
  import.meta.dirname,
  ".e2e-artifacts",
  "modeling-contest-template-project-uuid.txt",
);

export function writeModelingContestTemplateProjectUuidArtifact(uuid: string): void {
  fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
  fs.writeFileSync(ARTIFACT, `${uuid.trim()}\n`, "utf8");
}

export function readModelingContestTemplateProjectUuidArtifact(): string | null {
  try {
    const u = fs.readFileSync(ARTIFACT, "utf8").trim();
    return u.length > 0 ? u : null;
  } catch {
    return null;
  }
}
