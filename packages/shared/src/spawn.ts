import { spawn } from "node:child_process";

/**
 * 어댑터 공용 프로세스 실행 유틸. 러너(Playwright/pytest)를 셸로 실행하고 출력을 수집한다.
 */

export interface SpawnResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
}

/**
 * 셸 명령을 실행하고 stdout/stderr/exit code를 수집한다.
 * 테스트 러너는 실패 시 0이 아닌 코드를 반환하므로 reject하지 않고 항상 resolve한다
 * — 코드는 호출자가 해석한다.
 */
export function runCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  env: NodeJS.ProcessEnv = process.env
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);

    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: `${stderr}\n${err.message}`, code: null });
    });
  });
}

/** stdout에서 첫 번째 균형 잡힌 JSON 객체를 추출한다 (러너가 로그를 섞어 출력하는 경우 대비). */
export function extractJson(stdout: string): string | undefined {
  const start = stdout.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < stdout.length; i++) {
    const ch = stdout[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === "\\") {
      esc = true;
      continue;
    }
    if (ch === '"') inStr = !inStr;
    if (inStr) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return stdout.slice(start, i + 1);
    }
  }
  return undefined;
}
