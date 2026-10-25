"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState } from "react";

const groups = [
  { id: "dated", title: "有日期的", hint: "付款日和免费取消截止，按日期排", match: (todo) => Boolean(todo.dueDate) },
  { id: "book", title: "要订的", hint: "机票、住宿、租车、餐厅", match: (todo) => !todo.dueDate && todo.kind === "book" },
  { id: "prep", title: "要准备的", hint: "证件和出发前要弄清楚的事", match: (todo) => !todo.dueDate && todo.kind !== "book" },
];

const kindLabels = { pay: "付款", deadline: "取消截止", prep: "准备", book: "预订" };

export default function Nz2027Checklist({ todos, checklist }) {
  const [today, setToday] = useState("");
  const [hideDone, setHideDone] = useState(false);
  useEffect(() => setToday(localDate(new Date())), []);

  const doneCount = todos.filter((todo) => checklist.isDone(todo.id)).length;
  const percent = todos.length ? Math.round((doneCount / todos.length) * 100) : 0;

  return (
    <>
      <section className="nz-check-head" aria-label="清单进度">
        <h1>出发前清单</h1>
        <p><b>{doneCount}</b> / {todos.length} 已办完</p>
        <div className="nz-progress" role="progressbar" aria-valuemin={0} aria-valuemax={todos.length} aria-valuenow={doneCount} aria-label="已办完">
          <span style={{ width: `${percent}%` }} />
        </div>
        <div className="nz-check-tools">
          <small role="status" aria-live="polite">{checklist.syncLabel}</small>
          <label className="nz-switch">
            <input type="checkbox" checked={hideDone} onChange={(event) => setHideDone(event.target.checked)} />
            隐藏已办完的
          </label>
        </div>
      </section>

      {groups.map((group) => {
        const items = todos
          .filter(group.match)
          .sort((left, right) => (group.id === "dated" ? left.dueDate.localeCompare(right.dueDate) : left.sortOrder - right.sortOrder));
        const visible = hideDone ? items.filter((todo) => !checklist.isDone(todo.id)) : items;
        const remaining = items.filter((todo) => !checklist.isDone(todo.id)).length;
        return (
          <section className="nz-check-group" key={group.id} aria-label={group.title}>
            <header>
              <h2>{group.title}</h2>
              <span>{remaining ? `还剩 ${remaining}` : "都办完了"}</span>
            </header>
            <p className="nz-check-hint">{group.hint}</p>
            <ul>
              {visible.map((todo) => {
                const done = checklist.isDone(todo.id);
                const late = !done && today && todo.dueDate && todo.dueDate < today;
                return (
                  <li key={todo.id} className={["nz-check", done ? "is-done" : "", late ? "is-late" : ""].filter(Boolean).join(" ")}>
                    <label>
                      <input type="checkbox" checked={done} onChange={(event) => checklist.toggle(todo.id, event.target.checked)} />
                      <span className="nz-check-box" aria-hidden="true" />
                      <span className="nz-check-text">
                        <span className="nz-check-meta">
                          <b>{todo.dueLabel}</b>
                          <i>{kindLabels[todo.kind]}</i>
                          {late && <i className="nz-late">已过期</i>}
                        </span>
                        <strong>{todo.title}</strong>
                        <small>{todo.detail}</small>
                      </span>
                    </label>
                  </li>
                );
              })}
              {!visible.length && <li className="nz-check-empty">这一组都办完了。</li>}
            </ul>
          </section>
        );
      })}
    </>
  );
}

function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
