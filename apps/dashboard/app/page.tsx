import Link from "next/link";
import { evaluateApprovals } from "@qa/governance";
import { stores } from "../lib/store";

export const dynamic = "force-dynamic"; // 인메모리 상태 변경을 매 요청 반영

export default async function HomePage() {
  const proposals = await stores.proposals.list();
  const rows = await Promise.all(
    proposals.map(async (p) => {
      const approvals = await stores.approvals.forProposal(p.id);
      const evalResult = evaluateApprovals(p, approvals);
      return { p, approvals: approvals.length, satisfied: evalResult.satisfied };
    })
  );

  return (
    <main>
      <h1>Governance Console</h1>
      <p className="sub">AI 수정 제안을 검토·승인한다. AI는 PR 생성까지만 — 병합은 사람이 한다.</p>

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
            {rows.map(({ p, approvals, satisfied }) => {
              const view = stores.views.get(p.id);
              return (
                <tr key={p.id}>
                  <td>
                    <Link href={`/proposals/${p.id}`}>{view?.summary ?? p.id}</Link>
                    <div className="muted" style={{ fontSize: "0.78rem" }}>{p.signature}</div>
                  </td>
                  <td><span className={`badge ${p.scope}`}>{p.scope}</span></td>
                  <td className={view?.proofStatus === "passed" ? "pass" : "fail"}>
                    {view?.proofStatus ?? "?"}
                  </td>
                  <td>
                    {approvals}/{p.requiredApprovals}
                    {satisfied ? <span className="pass"> ✓</span> : null}
                  </td>
                  <td><span className={`badge ${p.status}`}>{p.status}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ fontSize: "0.8rem" }}>
        인메모리 시드 데이터. 운영에서는 동일 포트를 Postgres(migrations/001)로 교체.
      </p>
    </main>
  );
}
