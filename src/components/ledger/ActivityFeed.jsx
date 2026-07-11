import Link from "next/link";

import { activityDisplaySummary, recentActivity } from "@/lib/activity";

export default function ActivityFeed({ activity, fullPage = false, syncState = "已同步" }) {
  const allVisible = recentActivity(activity, 100);
  const visible = fullPage ? allVisible : allVisible.slice(0, 3);
  const local = syncState !== "已同步";

  return (
    <section className={fullPage ? "section activity-section activity-page" : "section activity-section"} data-motion="activity-panel">
      <div className="section-head" data-motion="section">
        <div>
          <span className="section-kicker">Change log</span>
          <h2>最近操作</h2>
        </div>
        <div className="activity-head-actions">
          <span className="muted">{allVisible.length ? `${allVisible.length} 条` : "暂无操作"}</span>
          {!fullPage && <Link href="/activity" className="button small">全部</Link>}
        </div>
      </div>
      {local && (
        <p className="activity-freshness" role="status">本机记录，联网同步后会自动核对。</p>
      )}
      <div className="activity-list">
        {!visible.length && (
          <article className="activity-row empty-state" data-motion="row">
            <div>
              <h3>还没有最近操作</h3>
              <p className="muted">新增、编辑、确认、删除费用后会显示在这里。</p>
            </div>
          </article>
        )}
        {visible.map((entry) => (
          <article className={local ? "activity-row is-local" : "activity-row"} key={entry.id} data-motion="row">
            <div>
              <h3>{activityDisplaySummary(entry)}</h3>
              <p className="muted">{formatActivityTime(entry.createdAt)}</p>
            </div>
            <div className="activity-tags">
              {local && <span className="tag draft">本机</span>}
              <span className="tag">{activityActionLabel(entry.action)}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function activityActionLabel(action) {
  if (action === "add") return "新增";
  if (action === "edit") return "编辑";
  if (action === "confirm") return "确认";
  if (action === "delete") return "删除";
  return "更新";
}

function formatActivityTime(value) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
