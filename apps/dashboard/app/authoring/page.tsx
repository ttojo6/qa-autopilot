import Link from "next/link";
import { listTestProposals } from "../../lib/data";

export const dynamic = "force-dynamic";

export default async function AuthoringPage() {
  const items = await listTestProposals();

  return (
    <main>
      <p><Link href="/">← Governance</Link></p>
      <h1>Authoring 리뷰 큐</h1>
      <p className="sub">AI가 생성한 테스트 초안. 승인해도 테스트 추가는 사람이 한다 (자동 추가 없음).</p>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>제안</th>
              <th>러너</th>
              <th>검증</th>
              <th>분류</th>
              <th>결정</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={5} className="muted">큐가 비어있다. `qa author` 로 초안을 생성한다.</td></tr>
            ) : (
              items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/authoring/${p.id}`}>{p.title}</Link>
                    <div className="muted" style={{ fontSize: "0.78rem" }}>{p.filePath}</div>
                  </td>
                  <td>{p.targetRunner}</td>
                  <td className={p.verifyOutcome === "runs_passes" ? "pass" : p.verifyOutcome === "errors" ? "fail" : "warn"}>
                    {p.verifyOutcome}
                  </td>
                  <td><span className="badge">{p.status}</span></td>
                  <td><span className={`badge ${p.decision === "approved" ? "approved" : p.decision === "rejected" ? "rejected" : "proposed"}`}>{p.decision}</span></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
