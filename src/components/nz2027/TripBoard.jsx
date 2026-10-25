const kindLabels = {
  booking: "待订",
  payment: "付款",
  deadline: "取消截止",
  prep: "准备",
};

export default function TripBoard({ itinerary, now = new Date() }) {
  const today = localDateString(now);
  const dated = (itinerary.todos || []).filter((todo) => todo.dueDate).sort((left, right) => left.dueDate.localeCompare(right.dueDate));
  const undated = (itinerary.todos || []).filter((todo) => !todo.dueDate);
  const dayLabels = new Map(itinerary.days.map((day) => [day.id, day.label]));

  return (
    <section className="trip-board" aria-label="行前清单与路线建议" data-motion="day-jump">
      <div className="trip-board-head">
        <span>Trip board</span>
        <h2>住宿、待办与路线建议</h2>
        <p>截止和付款时间均为住宿所在地当地时间。已订费用已作为初始记录放进“2027两人记账”，按原币种记录。</p>
      </div>

      <article className="trip-board-card trip-lodgings" aria-label="住宿地址和订单">
        <h3>住宿与免费取消</h3>
        <div className="lodging-rows">
          {(itinerary.lodgings || []).map((lodging) => (
            <div className={/待订/.test(lodging.status) ? "lodging-row is-pending" : "lodging-row"} key={lodging.sortOrder}>
              <div>
                <strong>{shortDate(lodging.checkIn)} → {shortDate(lodging.checkOut)} · {lodging.name}</strong>
                <small>{[lodging.room, lodging.detail].filter((value) => value && value !== "—").join("；")}</small>
              </div>
              <div className="lodging-meta">
                <span className="tag">{lodging.status}</span>
                {lodging.freeCancelUntil ? (
                  <small className={lodging.freeCancelUntil.slice(0, 10) < today ? "is-past" : ""}>免费取消至 {formatDeadline(lodging.freeCancelUntil)}</small>
                ) : lodging.afterDeadline ? <small>{lodging.afterDeadline}</small> : null}
                {lodging.resource?.url && <a href={lodging.resource.url} target="_blank" rel="noreferrer">地图</a>}
              </div>
            </div>
          ))}
        </div>
      </article>

      <article className="trip-board-card trip-todos" aria-label="出发前需要落实的事项">
        <h3>按日期：付款与截止</h3>
        <ol className="todo-timeline">
          {dated.map((todo) => (
            <li key={todo.sortOrder} className={[`todo-${todo.kind}`, todo.dueDate < today ? "is-past" : ""].filter(Boolean).join(" ")}>
              <span className="todo-due">{todo.dueLabel}</span>
              <div>
                <strong><em>{kindLabels[todo.kind]}</em>{todo.title}</strong>
                <small>{todo.detail}</small>
              </div>
            </li>
          ))}
        </ol>
        <h3>还要落实</h3>
        <ol className="todo-list">
          {undated.map((todo) => (
            <li key={todo.sortOrder}>
              <strong>{todo.title}</strong>
              <small>{todo.dueLabel} · {todo.detail}</small>
            </li>
          ))}
        </ol>
      </article>

      <article className="trip-board-card trip-advice" aria-label="路线建议">
        <h3>路线建议</h3>
        <p className="muted">在不动已订住宿的前提下整理；只有注明“改订单”的条目才涉及订单。</p>
        {(itinerary.advice || []).map((item) => (
          <details key={item.sortOrder} className="advice-item">
            <summary>
              <span className="tag">{item.verdict}</span>
              <strong>{item.title}</strong>
              {item.dayIds.length > 0 && <small>{item.dayIds.map((id) => dayLabels.get(id)).join(" / ")}</small>}
            </summary>
            <p>{item.detail}</p>
            {item.action && <p className="advice-action">{item.action}</p>}
            {item.resources.length > 0 && (
              <div className="resource-links">
                {item.resources.map((resource) => (
                  <a key={resource.id} href={resource.url} target="_blank" rel="noreferrer">地图 · {resource.title}</a>
                ))}
              </div>
            )}
          </details>
        ))}
      </article>
    </section>
  );
}

function shortDate(date) {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

function formatDeadline(value) {
  const [date, time] = value.split(" ");
  return `${date.slice(0, 4)}/${shortDate(date)}${time ? ` ${time}` : ""}`;
}

function localDateString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
