import Link from "next/link";
import { evaluateApprovals } from "@qa/governance";
import { listViews, getApprovals, getSafety, backend } from "../lib/data";

export const dynamic = "force-dynamic"; // 상태 변경을 매 요청 반영

const pct = (n: number): string => `${(n * 100).toFixed(0)}%`;

export default async function HomePage() {
  const views = await listViews();
  const safety = await getSafety();
  const rows = await Promise.all(
    views.map(async (v) => {
      const approvals = await getApprovals(v.id);
      const evalResult = evaluateApprovals(v, approvals);
      return { v, approvals: approvals.length, satisfied: evalResult.satisfied };
    })
  );

  return (
    <main>
      <h1>Governance Console</h1>
      <p className="sub">AI 수정 제안을 검토·승인한다. AI는 PR 생성까지만 — 병합은 사람이 한다.</p>

      <div className="card">
        <strong>Safety</strong>{" "}
        <span className="muted" style={{ fontSize: "0.8rem" }}>
          (n={safety.samples}) quarantine {pct(safety.metrics.quarantineRatio)} · override{" "}
          {pct(safety.metrics.overrideRate)} · rollback {pct(safety.metrics.rollbackRate)}
        </span>
        {safety.triggers.length === 0 ? (
          <span className="pass" style={{ marginLeft: 8 }}>✓ all automation enabled</span>
        ) : (
          <ul className="reasons">
            {safety.triggers.map((t) => (
              <li key={t.risk}>⚠ STOP {t.risk}: {t.message}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>제안</th>
              <th>범위</th>
              <th>증빙</th>
              <th>승인</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ v, approvals, satisfied }) => (
              <tr key={v.id}>
                <td>
                  <Link href={`/proposals/${v.id}`}>{v.summary || v.id}</Link>
                  <div className="muted" style={{ fontSize: "0.78rem" }}>{v.signature}</div>
                </td>
                <td><span className={`badge ${v.scope}`}>{v.scope}</span></td>
                <td className={v.proofStatus === "passed" ? "pass" : "fail"}>{v.proofStatus}</td>
                <td>
                  {approvals}/{v.requiredApprovals}
                  {satisfied ? <span className="pass"> ✓</span> : null}
                </td>
                <td><span className={`badge ${v.status}`}>{v.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ fontSize: "0.8rem" }}>
        backend: <b>{backend}</b>
        {backend === "memory"
          ? " — 시드/핸드오프(QA_PROPOSALS_FILE). DATABASE_URL 설정 시 Postgres 공유."
          : " — CLI와 동일 DATABASE_URL 공유."}
      </p>
    </main>
  );
}
