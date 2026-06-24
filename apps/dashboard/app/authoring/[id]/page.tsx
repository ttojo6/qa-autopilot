import Link from "next/link";
import { notFound } from "next/navigation";
import { getTestProposal } from "../../../lib/data";
import { decideTestProposal } from "../../actions";
import { DiffBlock } from "../../proposals/[id]/diff";

export const dynamic = "force-dynamic";

export default async function TestProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getTestProposal(id);
  if (!p) notFound();

  const reviewable = p.status === "pending_review" && p.decision === "pending";

  return (
    <main>
      <p><Link href="/authoring">← Authoring 큐</Link></p>
      <h1>{p.title}</h1>
      <p className="sub">
        <span className="badge">{p.targetRunner}</span>{" "}
        <span className="badge">{p.status}</span>{" "}
        <span className={`badge ${p.decision === "approved" ? "approved" : p.decision === "rejected" ? "rejected" : "proposed"}`}>{p.decision}</span>
      </p>

      <div className="card">
        <p className="kv"><b>파일</b> {p.filePath}</p>
        <p className="kv"><b>근거</b> {p.rationale}</p>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>검증</h3>
        <p className={p.verifyOutcome === "runs_passes" ? "pass" : p.verifyOutcome === "errors" ? "fail" : "warn"}>
          {p.verifyOutcome.toUpperCase()} — {p.verifyEvidence}
        </p>
        {p.verifyOutcome === "runs_fails" && (
          <p className="warn">실행됐지만 실패 — 진짜 버그이거나 잘못된 단언. 사람이 판단한다.</p>
        )}
        {p.status === "rejected_error" && (
          <p className="fail">실행조차 안 되는 초안(import/문법) — 리뷰 대상에서 배제됨.</p>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>초안 diff</h3>
        <DiffBlock diff={p.diff} />
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>리뷰</h3>
        {reviewable ? (
          <form className="decide" action={decideTestProposal}>
            <input type="hidden" name="id" value={p.id} />
            <button className="approve" name="decision" value="approved" type="submit">승인 (사람이 추가)</button>
            <button className="reject" name="decision" value="rejected" type="submit">거절</button>
          </form>
        ) : (
          <p className="muted">
            {p.status !== "pending_review"
              ? `이 초안은 ${p.status} 상태라 리뷰 대상이 아니다.`
              : `이미 ${p.decision} 됨.`}
          </p>
        )}
        <p className="muted" style={{ fontSize: "0.78rem" }}>
          승인은 "테스트로 채택" 의사일 뿐 — AI는 테스트를 레포에 추가하지 않는다. 사람이 추가/PR 한다.
        </p>
      </div>
    </main>
  );
}
