// 编辑器/列表持久化回归 —— 改动即存（含 updatedAt）、卸载兜底落盘、已保存提示、新建带拍号与散板
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '../src/pages/Editor';
import { ScoreList } from '../src/pages/ScoreList';
import { getScore, listScores, saveScore } from '../src/lib/storage';
import { newEmptyScore } from '../src/lib/factory';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(async () => {
  const dbs = await indexedDB.databases();
  for (const d of dbs) {
    if (d.name) indexedDB.deleteDatabase(d.name);
  }
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount());
    root = null;
  }
  container.remove();
});

const tick = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

function pressKey(k: string) {
  const el = container.querySelector('[data-testid="editor-page"]')!;
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
}

describe('编辑器持久化', () => {
  it('改动后自动保存：内容与 updatedAt 一起落盘，并显示已保存时间', async () => {
    const s = { ...newEmptyScore('回归A'), updatedAt: 1000 };
    await saveScore(s);
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(Editor, { scoreId: s.id, onNavigate: () => {} }));
    });
    await tick(50); // 等 getScore 加载
    expect(container.querySelector<HTMLInputElement>('[data-testid="score-title"]')!.value).toBe('回归A');

    await act(async () => pressKey('+')); // BPM +2
    await tick(700); // 防抖 400ms 后落盘

    const got = (await getScore(s.id))!;
    expect(got.bpm).toBe(s.bpm + 2);
    expect(got.updatedAt).toBeGreaterThan(1000);
    expect(container.querySelector('[data-testid="saved-at"]')!.textContent).toContain('已保存');
  });

  it('改完立刻离开页面：卸载时兜底保存，末尾改动不丢', async () => {
    const s = newEmptyScore('回归B');
    await saveScore(s);
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(Editor, { scoreId: s.id, onNavigate: () => {} }));
    });
    await tick(50);
    await act(async () => pressKey('+'));
    // 不等防抖，直接卸载（模拟立刻切路由）
    await act(async () => root!.unmount());
    root = null;
    await tick(50);
    expect((await getScore(s.id))!.bpm).toBe(s.bpm + 2);
  });

  it('勾了散板存下来再打开，散板标记还在', async () => {
    const s = newEmptyScore('回归C');
    await saveScore(s);
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(Editor, { scoreId: s.id, onNavigate: () => {} }));
    });
    await tick(50);
    const chk = container.querySelector<HTMLInputElement>('[data-testid="chk-freemeter"]')!;
    await act(async () => chk.click());
    expect(chk.checked).toBe(true);
    await tick(700); // 落盘
    expect((await getScore(s.id))!.freeMeter).toBe(true);
  });
});

describe('新建曲目参数', () => {
  it('首页选的拍号与散板带入新谱', async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(ScoreList));
    });
    await tick(20);
    const title = container.querySelector<HTMLInputElement>('[data-testid="new-title"]')!;
    const setVal = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setVal.call(title, '带参数新谱');
      title.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const sel = container.querySelector<HTMLSelectElement>('[data-testid="new-bpb"]')!;
    const setSel = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
    await act(async () => {
      setSel.call(sel, '3');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => container.querySelector<HTMLInputElement>('[data-testid="new-free"]')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="btn-create"]')!.click());
    await tick(50);
    const created = (await listScores()).find((x) => x.title === '带参数新谱')!;
    expect(created).toBeDefined();
    expect(created.bars[0].beatsPerBar).toBe(3);
    expect(created.freeMeter).toBe(true);
  });
});
