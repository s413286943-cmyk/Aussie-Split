"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useMemo, useState } from "react";

import { buildImportPreview, mergeImportedTravelData, parseTravelMarkdown } from "@/lib/travelImport";
import { initialTravelDays, initialTripItems, listSections, tripItemStatuses } from "@/lib/travelSeed";
import {
  deleteRemoteItem,
  fetchRemoteTravelData,
  mergeTravelData,
  saveRemoteDay,
  saveRemoteItem,
  travelStorageKey,
} from "@/lib/travelStore";
import { fetchDayWeather, makeClothingAdvice } from "@/lib/weather";

import AppShell from "./AppShell";

const seed = { days: initialTravelDays, items: initialTripItems };

export default function TravelWorkspace({ view }) {
  const [days, setDays] = useState(initialTravelDays);
  const [items, setItems] = useState(initialTripItems);
  const [status, setStatus] = useState("本机已准备");
  const [weatherByDay, setWeatherByDay] = useState({});
  const [importedGuide, setImportedGuide] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const today = useMemo(() => pickToday(days), [days]);

  useEffect(() => {
    const saved = localStorage.getItem(travelStorageKey);
    let hasSavedContent = false;
    if (saved) {
      const parsed = JSON.parse(saved);
      setDays(parsed.days || initialTravelDays);
      setItems(parsed.items || initialTripItems);
      setStatus("显示上次保存的内容");
      hasSavedContent = true;
    }

    fetchRemoteTravelData()
      .then((remote) => {
        if (!remote) {
          setStatus(hasSavedContent ? "显示上次保存的内容" : "本机已准备");
          return;
        }

        const merged = mergeTravelData(seed, remote);
        setDays(merged.days);
        setItems(merged.items);
        localStorage.setItem(travelStorageKey, JSON.stringify(merged));
        setStatus("已保存");
      })
      .catch(() => setStatus("现在先显示上次保存的内容"));
  }, []);

  useEffect(() => {
    if (!today) return;

    fetchDayWeather(today)
      .then((weather) => {
        if (weather) setWeatherByDay((current) => ({ ...current, [today.id]: weather }));
      })
      .catch(() => {});
  }, [today]);

  async function persist(nextDays, nextItems, remoteAction) {
    setDays(nextDays);
    setItems(nextItems);
    localStorage.setItem(travelStorageKey, JSON.stringify({ days: nextDays, items: nextItems }));
    setStatus("正在保存");

    try {
      await remoteAction?.();
      setStatus("已保存");
    } catch {
      setStatus("现在先保存在本机");
    }
  }

  async function updateDay(day) {
    const nextDays = days.map((entry) => (entry.id === day.id ? day : entry));
    await persist(nextDays, items, () => saveRemoteDay(day));
  }

  async function moveBlock(fromDayId, block, toDayId) {
    if (fromDayId === toDayId) return;

    const nextDays = days.map((day) => {
      if (day.id === fromDayId) return { ...day, blocks: day.blocks.filter((entry) => entry.id !== block.id) };
      if (day.id === toDayId) return { ...day, blocks: [...day.blocks, block] };
      return day;
    });
    const changedDays = nextDays.filter((day) => day.id === fromDayId || day.id === toDayId);
    await persist(nextDays, items, () => Promise.all(changedDays.map((day) => saveRemoteDay(day))));
  }

  async function updateItem(item) {
    const nextItems = items.map((entry) => (entry.id === item.id ? item : entry));
    await persist(days, nextItems, () => saveRemoteItem(item));
  }

  async function addItem(kind) {
    const section = listSections.find((entry) => entry.kind === kind);
    const item = {
      id: `${kind}-${Date.now()}`,
      kind,
      title: `新的${section.title}`,
      relatedDayId: "",
      city: "",
      status: "还没订",
      amount: 0,
      currency: "",
      note: "",
      link: "",
      sortOrder: items.length + 1,
    };

    await persist(days, [...items, item], () => saveRemoteItem(item));
  }

  async function removeItem(id) {
    if (!window.confirm("确定删除这一条吗？")) return;
    await persist(days, items.filter((item) => item.id !== id), () => deleteRemoteItem(id));
  }

  async function importMarkdown(file) {
    if (!file) return;

    const markdown = await file.text();
    const imported = parseTravelMarkdown(markdown);
    setImportedGuide(imported);
    setImportPreview(buildImportPreview({ days, items }, imported));
  }

  async function confirmImport() {
    if (!importedGuide) return;

    const merged = mergeImportedTravelData({ days, items }, importedGuide);
    setImportedGuide(null);
    setImportPreview(null);
    await persist(merged.days, merged.items, async () => {
      await Promise.all([
        ...merged.days.map((day) => saveRemoteDay(day)),
        ...merged.items.map((item) => saveRemoteItem(item)),
      ]);
    });
  }

  return (
    <AppShell view={view} status={status}>
      {view !== "today" && (
        <ImportGuidePanel preview={importPreview} onChooseFile={importMarkdown} onConfirm={confirmImport} onCancel={() => {
          setImportedGuide(null);
          setImportPreview(null);
        }} />
      )}
      {view === "today" && <TodayView days={days} day={today} items={items} weather={weatherByDay[today?.id]} onChangeDay={updateDay} onMoveBlock={moveBlock} />}
      {view === "itinerary" && <ItineraryView days={days} items={items} onChangeDay={updateDay} onMoveBlock={moveBlock} />}
      {view === "lists" && <ListsView days={days} items={items} onChangeItem={updateItem} onAddItem={addItem} onDeleteItem={removeItem} />}
    </AppShell>
  );
}

function TodayView({ days, day, items, weather, onChangeDay, onMoveBlock }) {
  if (!day) return null;

  const relatedItems = items.filter((item) => item.relatedDayId === day.id).slice(0, 6);
  const clothing = weather ? makeClothingAdvice(weather, day.clothingNote) : day.clothingNote;

  return (
    <>
      <section className="section today-panel">
        <p className="eyebrow">{day.date} {day.weekday}</p>
        <h2>{day.title}</h2>
        <p>{day.focus}</p>
        <div className="tags">
          <span className="tag">{day.city}</span>
          <span className="tag">{day.lodging || "住宿待补"}</span>
        </div>
      </section>
      <section className="section card">
        <div className="section-head">
          <h2>今天穿什么</h2>
          <span className="muted">{weather ? `${weather.minTemp}-${weather.maxTemp}°C` : "先看攻略提醒"}</span>
        </div>
        <p>{clothing}</p>
      </section>
      <DayEditor days={days} day={day} onChange={onChangeDay} onMoveBlock={onMoveBlock} compact />
      <RelatedItems items={relatedItems} />
    </>
  );
}

function ItineraryView({ days, items, onChangeDay, onMoveBlock }) {
  const [selectedDayId, setSelectedDayId] = useState(pickToday(days)?.id || days[0]?.id || "");
  const selectedDay = days.find((day) => day.id === selectedDayId) || days[0];
  const relatedItems = selectedDay ? items.filter((item) => item.relatedDayId === selectedDay.id) : [];

  return (
    <>
      <DayIndex days={days} selectedDayId={selectedDay?.id} onSelect={setSelectedDayId} />
      {selectedDay && (
        <section className="section timeline">
          <DayEditor
            days={days}
            day={selectedDay}
            key={selectedDay.id}
            relatedItems={relatedItems}
            onChange={onChangeDay}
            onMoveBlock={onMoveBlock}
          />
        </section>
      )}
    </>
  );
}

function ListsView({ days, items, onChangeItem, onAddItem, onDeleteItem }) {
  return (
    <>
      <SectionIndex sections={listSections} />
      {listSections.map((section) => {
        const sectionItems = items.filter((item) => item.kind === section.kind);

        return (
          <section className="section" id={`section-${section.kind}`} key={section.kind}>
            <div className="section-head">
              <h2>{section.title}</h2>
              <button className="button small" type="button" onClick={() => onAddItem(section.kind)}>加一条</button>
            </div>
            <div className="planner-grid">
              {sectionItems.map((item) => (
                <TripItemEditor days={days} item={item} key={item.id} onChange={onChangeItem} onDelete={() => onDeleteItem(item.id)} />
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}

function DayIndex({ days, selectedDayId, onSelect }) {
  return (
    <section className="section index-panel" aria-label="行程索引">
      <div className="section-head">
        <div>
          <h2>选一天看</h2>
          <span className="muted">先选 D 日，再改当天安排</span>
        </div>
        <label className="compact-select">
          当前
          <select value={selectedDayId || ""} onChange={(event) => onSelect(event.target.value)}>
            {days.map((day) => (
              <option key={day.id} value={day.id}>{day.id.toUpperCase()} · {day.title}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="index-links">
        {days.map((day) => (
          <button className={day.id === selectedDayId ? "active" : ""} type="button" onClick={() => onSelect(day.id)} key={day.id}>
            <strong>{day.id.toUpperCase()}</strong>
            <span>{day.title}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function SectionIndex({ sections }) {
  return (
    <section className="section index-panel" aria-label="清单索引">
      <div className="section-head">
        <h2>清单索引</h2>
        <span className="muted">按类型看</span>
      </div>
      <div className="index-links">
        {sections.map((section) => (
          <a href={`#section-${section.kind}`} key={section.kind}>
            {section.title}
          </a>
        ))}
      </div>
    </section>
  );
}

function DayEditor({ days, day, relatedItems = [], onChange, onMoveBlock, compact = false }) {
  function changeBlock(nextBlock) {
    onChange({ ...day, blocks: day.blocks.map((block) => (block.id === nextBlock.id ? nextBlock : block)) });
  }

  function addBlock() {
    onChange({
      ...day,
      blocks: [
        ...day.blocks,
        {
          id: `${day.id}-block-${Date.now()}`,
          period: "补一个时间",
          place: "补一个地点",
          activity: "新的安排",
          highlight: "",
          tip: "",
          photoSpot: "",
        },
      ],
    });
  }

  function deleteBlock(id) {
    if (!window.confirm("确定删除这段安排吗？")) return;
    onChange({ ...day, blocks: day.blocks.filter((block) => block.id !== id) });
  }

  return (
    <article className="planner-card" id={day.id}>
      <div className="section-head">
        <div>
          <p className="eyebrow">{day.id.toUpperCase()} · {day.date} · {day.weekday}</p>
          <h2>{day.title}</h2>
        </div>
        <button className="button small" type="button" onClick={addBlock}>加一个时间段</button>
      </div>
      <div className="form-grid">
        <Field label="城市" value={day.city} onChange={(city) => onChange({ ...day, city })} />
        <Field label="标题" value={day.title} onChange={(title) => onChange({ ...day, title })} />
        <Field label="住宿" value={day.lodging} onChange={(lodging) => onChange({ ...day, lodging })} />
        <TextAreaField label="今天重点" value={day.focus} onChange={(focus) => onChange({ ...day, focus })} />
        <TextAreaField label="穿衣提醒" value={day.clothingNote} onChange={(clothingNote) => onChange({ ...day, clothingNote })} />
        <TextAreaField label="备选安排" value={day.backupNote} onChange={(backupNote) => onChange({ ...day, backupNote })} />
      </div>
      <div className={compact ? "day-blocks compact" : "day-blocks"}>
        {day.blocks.map((block) => (
          <EditableBlock
            days={days}
            block={block}
            currentDayId={day.id}
            key={block.id}
            onChange={changeBlock}
            onMove={(toDayId) => onMoveBlock(day.id, block, toDayId)}
            onDelete={() => deleteBlock(block.id)}
          />
        ))}
      </div>
      {relatedItems.length > 0 && <RelatedItems items={relatedItems.slice(0, 4)} compact />}
    </article>
  );
}

function EditableBlock({ days, block, currentDayId, onChange, onMove, onDelete }) {
  return (
    <article className="planner-card nested">
      <div className="form-grid">
        <label>
          放在哪天
          <select value={currentDayId} onChange={(event) => onMove(event.target.value)}>
            {days.map((day) => (
              <option value={day.id} key={day.id}>{day.id.toUpperCase()} · {day.title}</option>
            ))}
          </select>
        </label>
        <Field label="时间" value={block.period} onChange={(period) => onChange({ ...block, period })} />
        <Field label="地点" value={block.place} onChange={(place) => onChange({ ...block, place })} />
        <TextAreaField label="做什么" value={block.activity} onChange={(activity) => onChange({ ...block, activity })} />
        <TextAreaField label="为什么值得去" value={block.highlight} onChange={(highlight) => onChange({ ...block, highlight })} />
        <TextAreaField label="提醒" value={block.tip} onChange={(tip) => onChange({ ...block, tip })} />
        <TextAreaField label="拍照点" value={block.photoSpot} onChange={(photoSpot) => onChange({ ...block, photoSpot })} />
      </div>
      <button className="button small danger" type="button" onClick={onDelete}>删除这一段</button>
    </article>
  );
}

function TripItemEditor({ days, item, onChange, onDelete }) {
  return (
    <article className="planner-card">
      <div className="form-grid">
        <Field label="名字" value={item.title} onChange={(title) => onChange({ ...item, title })} />
        <label>
          分到哪里
          <select value={item.kind} onChange={(event) => onChange({ ...item, kind: event.target.value })}>
            {listSections.map((section) => (
              <option value={section.kind} key={section.kind}>{section.title}</option>
            ))}
          </select>
        </label>
        <label>
          放在哪天
          <select value={item.relatedDayId || ""} onChange={(event) => onChange({ ...item, relatedDayId: event.target.value })}>
            <option value="">不固定</option>
            {days.map((day) => (
              <option value={day.id} key={day.id}>{day.id.toUpperCase()} · {day.title}</option>
            ))}
          </select>
        </label>
        <Field label="城市" value={item.city} onChange={(city) => onChange({ ...item, city })} />
        <label>
          现在怎样
          <select value={item.status} onChange={(event) => onChange({ ...item, status: event.target.value })}>
            {tripItemStatuses.map((status) => <option key={status}>{status}</option>)}
          </select>
        </label>
        <Field label="金额" value={String(item.amount || "")} onChange={(amount) => onChange({ ...item, amount: Number(amount || 0) })} />
        <Field label="币种" value={item.currency} onChange={(currency) => onChange({ ...item, currency })} />
        <Field label="链接" value={item.link} onChange={(link) => onChange({ ...item, link })} />
        <TextAreaField label="备注" value={item.note} onChange={(note) => onChange({ ...item, note })} />
      </div>
      <button className="button small danger" type="button" onClick={onDelete}>删除这一条</button>
    </article>
  );
}

function ImportGuidePanel({ preview, onChooseFile, onConfirm, onCancel }) {
  return (
    <section className="section planner-card">
      <div className="section-head">
        <div>
          <h2>导入新版攻略</h2>
          <p className="muted">适合整份攻略大改。小改动可以直接在下面改。</p>
        </div>
        <label className="button small">
          选择 MD
          <input className="visually-hidden" type="file" accept=".md,.markdown,text/markdown,text/plain" onChange={(event) => onChooseFile(event.target.files?.[0] || null)} />
        </label>
      </div>
      {preview && (
        <div className="import-preview">
          <PreviewBucket title="新增" entries={preview.added} />
          <PreviewBucket title="会更新" entries={preview.updated} />
          <PreviewBucket title="保留不变" entries={preview.unchanged} />
          <PreviewBucket title="可能没识别" entries={preview.unrecognized} />
          <div className="row">
            <button className="button primary" type="button" onClick={onConfirm}>确认导入</button>
            <button className="button" type="button" onClick={onCancel}>先不导入</button>
          </div>
        </div>
      )}
    </section>
  );
}

function PreviewBucket({ title, entries }) {
  return (
    <div>
      <h3>{title} · {entries.length}</h3>
      <div className="tags">
        {entries.slice(0, 8).map((entry) => <span className="tag" key={entry.id}>{entry.label}</span>)}
        {entries.length > 8 && <span className="tag">还有 {entries.length - 8} 条</span>}
      </div>
    </div>
  );
}

function RelatedItems({ items, compact = false }) {
  if (!items.length) return null;

  return (
    <section className={compact ? "related-items compact" : "section related-items"}>
      <div className="section-head">
        <h2>顺手看</h2>
        <span className="muted">{items.length} 项</span>
      </div>
      <div className="item-grid">
        {items.map((item) => (
          <article className="card" key={item.id}>
            <span className="tag">{item.status}</span>
            <h3>{item.title}</h3>
            <p className="muted">{item.city || "全程"}{item.relatedDayId ? ` · ${item.relatedDayId.toUpperCase()}` : ""}</p>
            <p>{item.note}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Field({ label, value, onChange }) {
  return (
    <label>
      {label}
      <input value={value || ""} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function TextAreaField({ label, value, onChange }) {
  return (
    <label>
      {label}
      <textarea value={value || ""} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function pickToday(days) {
  const todayIso = new Date().toISOString().slice(0, 10);
  return days.find((day) => day.date >= todayIso) || days.at(-1);
}
