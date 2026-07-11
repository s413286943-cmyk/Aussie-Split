export default function StageNavigator({ stages, days, currentDay, selectedStageId, onSelectStage, showAll, onToggleAll }) {
  const selectedStage = stages.find((stage) => stage.id === selectedStageId);
  const nextDay = days[days.findIndex((day) => day.id === currentDay.id) + 1] || null;

  return (
    <section className="stage-navigator" aria-label="当前行程阶段" data-motion="day-jump">
      <div className="live-route-strip">
        <span><small>今天</small><strong>{currentDay.label} · {currentDay.city}</strong></span>
        <span><small>阶段</small><strong>{selectedStage?.title || "出发 / 返程"}</strong></span>
        <span><small>下一站</small><strong>{nextDay ? `${nextDay.label} · ${nextDay.city}` : "返程收尾"}</strong></span>
      </div>
      <div className="stage-tabs" role="tablist" aria-label="行程阶段">
        {stages.map((stage) => (
          <button
            key={stage.id}
            type="button"
            role="tab"
            aria-selected={stage.id === selectedStageId}
            className={stage.id === selectedStageId ? "is-active" : ""}
            onClick={() => onSelectStage(stage.id)}
          >
            {stage.title}
          </button>
        ))}
        <button className="stage-all-toggle" type="button" onClick={onToggleAll}>{showAll ? "收起其他阶段" : "查看全部路书"}</button>
      </div>
    </section>
  );
}
