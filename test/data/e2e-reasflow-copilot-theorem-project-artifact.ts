import fs from "node:fs";
import path from "node:path";

/** §16 串行用例复用的定理证明（MIL）项目 UUID；与 §8 的 `theorem-project-uuid.txt` 分离。 */
const ARTIFACT = path.join(
  import.meta.dirname,
  ".e2e-artifacts",
  "reasflow-copilot-theorem-project-uuid.txt",
);

export function clearReasFlowCopilotTheoremProjectUuidArtifact(): void {
  try {
    fs.unlinkSync(ARTIFACT);
  } catch {
    /* ignore */
  }
}

export function writeReasFlowCopilotTheoremProjectUuidArtifact(uuid: string): void {
  fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
  fs.writeFileSync(ARTIFACT, `${uuid.trim()}\n`, "utf8");
}

export function readReasFlowCopilotTheoremProjectUuidArtifact(): string | null {
  try {
    const u = fs.readFileSync(ARTIFACT, "utf8").trim();
    return u.length > 0 ? u : null;
  } catch {
    return null;
  }
}
