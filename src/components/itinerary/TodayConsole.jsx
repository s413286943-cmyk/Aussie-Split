import Link from "next/link";

import { formatMoney } from "@/lib/ledger";
import {
  buildDayCarryChecklist,
  buildDayDocket,
  buildTodayCommand,
  collectTodayResources,
  summarizeDayLedger,
} from "@/lib/today";
import TravelAssistantPanel from "./TravelAssistantPanel";

const resourceLabels = {
  map: "地图",
  official: "官网",
  booking: "预订",
  restaurant: "餐厅",
};

export default function TodayConsole({ day, weather, ledgerExpenses, ledgerFreshness, checkedKitItems, onToggleKitItem }) {
  const quickResources = collectTodayResources(day);
  const keyStops = primaryBlocks(day).slice(0, 3);
  const carryItems = buildDayCarryChecklist(day);
  const ledgerSummary = summarizeDayLedger(day, ledgerExpenses);
  const command = buildTodayCommand(day);
  const docket = buildDayDocket(day, ledgerExpenses);

  return (
    <section className="today-console docket-panel" aria-label="今日旅行控制台" data-motion="today-console">
      <div className="today-command-head">
        <div className="today-summary">
          <span>今日旅行控制台</span>
          <h2>{day.label} · {formatShortDate(day)} {day.weekday} · {day.city}</h2>
          <p>{day.title}</p>
          <small>{day.focus}</small>
        </div>
        <div className="today-route-note">
          <span>当日主线</span>
          {keyStops.map((block) => <strong key={`${day.id}-${block.sortOrder}`}>{block.place}</strong>)}
        </div>
      </div>
      <div className="today-status-grid">
        <article><span>今日交通</span><strong>{command.transport}</strong></article>
        <article><span>最晚出门</span><strong>{command.leaveBy}</strong></article>
        <article><span>今晚住宿</span><strong>{day.lodging}</strong></article>
        <article>
          <span>{weather?.status === "live" ? "实时天气" : weather?.status === "forecast" ? "天气预报" : "天气参考"}</span>
          <strong>{weather?.summary || day.climateNote}</strong>
        </article>
        <article>
          <span>{weather?.adviceLabel || "季节穿衣参考"}</span>
          <strong>{weather?.detail || day.clothingNote}</strong>
        </article>
      </div>
      <TodayMealBoard meals={command.meals} />
      <TodayDocketStrip docket={docket} />
      <TravelAssistantPanel
        day={day}
        weather={weather}
        checkedKitItems={checkedKitItems}
      />
      <div className="today-field-kit" aria-label="今日出门和账本联动">
        <TodayCarryChecklist day={day} items={carryItems} checkedItems={checkedKitItems} onToggleItem={onToggleKitItem} />
        <TodayLedgerDock day={day} summary={ledgerSummary} freshness={ledgerFreshness} />
      </div>
      <div className="today-detail-grid route-detail-grid">
        <div className="today-plan">
          <h3>今天节奏</h3>
          {day.blocks.map((block) => (
            <div className="today-plan-row" key={`${day.id}-${block.sortOrder}`}>
              <span>{block.period}</span>
              <div>
                <strong>{block.place}</strong>
                <p>{block.activity}</p>
                {block.tip && <small>{block.tip}</small>}
              </div>
            </div>
          ))}
        </div>
        <div className="today-links">
          <h3>快捷入口</h3>
          {command.mapActions.map((action) => (
            <a key={action.id} href={action.url} target="_blank" rel="noreferrer">{action.label} · {action.title}</a>
          ))}
          {quickResources.slice(0, 3).map((resource) => (
            <a key={resource.id} href={resource.url} target="_blank" rel="noreferrer">
              {resourceLabels[resource.type] || "链接"} · {resource.title}
            </a>
          ))}
          <div className="today-note-list">
            {command.notes.map((note) => <span key={note}>{note}</span>)}
          </div>
        </div>
      </div>
    </section>
  );
}

function TodayMealBoard({ meals }) {
  return (
    <section className="today-meal-board" aria-label="今日吃饭候选">
      <article className="meal-breakfast"><span>早餐</span><strong>{meals.breakfast}</strong></article>
      <article className="meal-lunch"><span>午餐</span><strong>{meals.lunch}</strong></article>
      <article className="meal-dinner"><span>晚餐</span><strong>{meals.dinner}</strong></article>
      <p>{meals.note}</p>
    </section>
  );
}

function TodayDocketStrip({ docket }) {
  return (
    <section className="today-docket-strip" aria-label="今日票夹">
      {docket.map((item) => (
        <article className={`docket-${item.id}`} key={item.id}>
          <span>{item.label}</span>
          <strong>{item.title}</strong>
          <p>{item.detail}</p>
          <small>{item.status}</small>
        </article>
      ))}
    </section>
  );
}

function TodayCarryChecklist({ day, items, checkedItems, onToggleItem }) {
  const checkedSet = new Set(checkedItems);
  const completedCount = items.filter((item) => checkedSet.has(item.id)).length;
  return (
    <section className="carry-checklist" aria-label={`${day.label} 不要忘清单`}>
      <div className="field-kit-head"><span>今日不要忘</span><strong>{completedCount}/{items.length}</strong></div>
      <div className="carry-checklist-items">
        {items.map((item) => {
          const checked = checkedSet.has(item.id);
          return (
            <label className={checked ? "carry-check-item is-checked" : "carry-check-item"} key={item.id}>
              <input type="checkbox" checked={checked} onChange={() => onToggleItem(day.id, item.id)} />
              <span><strong>{item.label}</strong><small>{item.detail}</small></span>
            </label>
          );
        })}
      </div>
    </section>
  );
}

function TodayLedgerDock({ day, summary, freshness }) {
  const unavailable = freshness === "unavailable";
  const totalText = unavailable ? "--" : formatLedgerTotals(summary.totalsByCurrency);
  const freshnessText = freshness === "current"
    ? "账本已同步 · 当前数据"
    : freshness === "cached"
      ? "本机缓存 · 可能不是最新"
      : unavailable
        ? "账本暂不可用 · 未显示缓存金额"
        : "正在核对账本数据";
  const quickActions = [
    { label: "记餐饮", category: "dining", item: `${day.label} 餐饮` },
    { label: "记交通", category: "交通", item: `${day.label} 交通` },
    { label: "记门票", category: "活动", item: `${day.label} 活动 / 门票` },
  ];

  return (
    <section className="today-ledger-dock" aria-label={`${day.label} 账本联动`}>
      <div className="field-kit-head"><span>今天账本</span><strong>{unavailable ? "暂不可用" : summary.count ? `${summary.count} 笔` : "未记账"}</strong></div>
      <small className="muted" role="status" aria-live="polite">{freshnessText}</small>
      <div className="ledger-dock-metrics">
        <article><span>今日合计</span><strong>{totalText}</strong></article>
        <article><span>待分摊</span><strong>{unavailable ? "--" : summary.pendingSplitCount}</strong></article>
        <article><span>待确认</span><strong>{unavailable ? "--" : summary.draftCount}</strong></article>
      </div>
      <div className="ledger-dock-actions">
        {quickActions.map((action) => <Link key={action.label} href={quickExpenseHref(day, action)}>{action.label}</Link>)}
        <Link href="/expenses">看明细</Link>
      </div>
      <div className="ledger-dock-recent" aria-label="今日已记费用">
        {!unavailable && summary.recentExpenses.length ? summary.recentExpenses.map((expense) => (
          <div key={expense.id}><span>{expense.item}</span><strong>{formatMoney(expense.currency, expense.amount)}</strong></div>
        )) : <p>{unavailable ? "账本暂不可用，仍可从这里快速记一笔。" : "今天发生共同费用后，从这里快速记一笔。"}</p>}
      </div>
    </section>
  );
}

function formatLedgerTotals(totalsByCurrency) {
  const entries = Object.entries(totalsByCurrency);
  if (!entries.length) return "¥0.00";
  return entries.map(([currency, amount]) => formatMoney(currency, amount)).join(" / ");
}

function quickExpenseHref(day, action) {
  const params = new URLSearchParams({ date: day.date, category: action.category, item: action.item });
  return `/add?${params.toString()}`;
}

function primaryBlocks(day) {
  return day.blocks.filter((block) => block.period !== "饮食");
}

function formatShortDate(day) {
  return day.date.slice(5).replace("-", ".");
}
