import Link from "next/link";
import { notFound } from "next/navigation";
import { getView, getApprovals } from "../../../lib/data";
import { evaluateApprovals } from "@qa/governance";
import { decide, disputeClassification, reportRollback } from "../../actions";
import { DiffBlock } from "./diff";

export const dynamic = "force-dynamic";

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; // Next 16: params는 Promise
  const view = await getView(id);
  if (!view) notFound();

  const proposal = view; // ProposalView는 ProposalRecord의 상위 집합
  const approvals = await getApprovals(id);
  const evalResult = evaluateApprovals(proposal, approvals);

  // app_source는 자동 PR 금지 — 항상 사람 PR. test_only는 증빙 통과 시 자동 PR 후보.
  const autoPrAllowed = proposal.scope === "test_only" && view.proofStatus === "passed";

  return (
    <main>
      <p><Link href="/">← 목록</Link></p>
      <h1>{view.summary}</h1>
      <p className="sub">
        <span className={`badge ${proposal.scope}`}>{proposal.scope}</span>{" "}
        <span className={`badge ${proposal.status}`}>{proposal.status}</span>{" "}
        <span className="muted">{view.failureClass}</span>
      </p>

      <div className="card">
        <p className="kv"><b>서명</b> {proposal.signature}</p>
        <p className="kv"><b>작성자</b> {proposal.author} <span className="muted">(AI는 자기 제안 승인 불가)</span></p>
        <p className="kv"><b>영향 파일</b> {view.affectedFiles.join(", ")}</p>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>회귀 증빙</h3>
        <p className={view.proofStatus === "passed" ? "pass" : "fail"}>
          {view.proofStatus.toUpperCase()} — {view.proofEvidence}
        </p>
        {view.proofStatus !== "passed" && (
          <p className="warn">증빙이 통과하지 않아 게이트가 자동 PR·승인 완료를 차단한다.</p>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>게이트</h3>
        <p className="kv"><b>자동 PR</b> {autoPrAllowed ? <span className="pass">허용 (test_only + 증빙 통과)</span> : <span className="warn">금지 — 사람 PR 필요</span>}</p>
        <p className="kv"><b>필요 승인</b> {proposal.requiredApprovals}인 {proposal.codeownersRequired ? "+ CODEOWNERS" : ""}</p>
        <p className="kv">
          <b>현재</b>{" "}
          {evalResult.satisfied
            ? <span className="pass">승인 충족 → 사람이 GitHub에서 병합 가능</span>
            : <span className="warn">미충족</span>}
        </p>
        {evalResult.blockingReasons.length > 0 && (
          <ul className="reasons">
            {evalResult.blockingReasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>제안 diff</h3>
        <DiffBlock diff={view.diff} />
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>승인 내역</h3>
        {approvals.length === 0 ? (
          <p className="muted">아직 없음</p>
        ) : (
          <ul>
            {approvals.map((a, i) => (
              <li key={i}>
                <b>{a.approver}</b> — {a.decision}
                {a.isCodeowner ? " (codeowner)" : ""}{" "}
                <span className="muted">{new Date(a.createdAt).toLocaleString("ko-KR")}</span>
              </li>
            ))}
          </ul>
        )}

        <form className="decide" action={decide}>
          <input type="hidden" name="proposalId" value={proposal.id} />
          <input type="text" name="approver" placeholder="승인자 이름 (예: alice)" required />
          <label className="check"><input type="checkbox" name="isCodeowner" /> CODEOWNER</label>
          <button className="approve" name="decision" value="approve" type="submit">승인</button>
          <button className="reject" name="decision" value="reject" type="submit">거절</button>
        </form>
        <p className="muted" style={{ fontSize: "0.78rem" }}>
          작성자(ai) 또는 ai/system 이름으로는 승인이 집계되지 않는다 (self-approve·봇승인 차단).
        </p>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>피드백 (STOP 트리거 자동 누적)</h3>
        <p className="muted" style={{ fontSize: "0.82rem" }}>
          이 버튼은 메타 지표에 바로 기록되어 R1/R2 STOP 트리거 평가에 반영된다 — 별도 명령 불필요.
        </p>
        <form className="decide" action={disputeClassification}>
          <input type="hidden" name="proposalId" value={proposal.id} />
          <button type="submit">분류 이의 (override · R1)</button>
        </form>
        <form className="decide" action={reportRollback}>
          <input type="hidden" name="proposalId" value={proposal.id} />
          <button className="reject" type="submit">롤백 보고 (rollback · R2)</button>
        </form>
      </div>
    </main>
  );
}
