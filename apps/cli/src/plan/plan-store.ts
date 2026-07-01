import { useSyncExternalStore } from 'react';
import type { PlanItem } from './plan-types.js';
import { planItemKey } from './plan-types.js';

// ── Module-local store ───────────────────────────────────────────
//
// Same pattern as useAsyncOperation.ts: a module-local, copy-on-write
// Map is the authority; consumers read it through useSyncExternalStore.
// Every mutation replaces the Map (and the affected array) with a new
// reference so React detects the change by identity and re-renders.
//
// The plan is per-PR and in-memory only — keyed by numeric PR id,
// never persisted to disk, and cleared after a successful checkout.

let plans = new Map<number, PlanItem[]>();
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): ReadonlyMap<number, PlanItem[]> {
  return plans;
}

function notify(): void {
  for (const cb of listeners) cb();
}

/** Copy-on-write helper: replace one PR's array, keeping others intact. */
function setItems(prId: number, items: PlanItem[]): void {
  plans = new Map(plans);
  if (items.length === 0) plans.delete(prId);
  else plans.set(prId, items);
  notify();
}

/**
 * Add (or re-snapshot) an item. If an item with the same identity
 * (kind + id) already exists it is replaced in place, preserving order
 * — this keeps the snapshot fresh without reordering the cart. An
 * existing user annotation is preserved when the incoming snapshot
 * carries none, so re-adding an item never silently drops its note.
 */
export function add(prId: number, item: PlanItem): void {
  const cur = plans.get(prId) ?? [];
  const key = planItemKey(item.kind, item.id);
  const idx = cur.findIndex((i) => planItemKey(i.kind, i.id) === key);
  const next = cur.slice();
  if (idx >= 0) {
    const prev = next[idx]!;
    next[idx] =
      item.annotation === undefined && prev.annotation !== undefined
        ? { ...item, annotation: prev.annotation }
        : item;
  } else next.push(item);
  setItems(prId, next);
}

export function remove(prId: number, kind: PlanItem['kind'], id: string): void {
  const cur = plans.get(prId);
  if (!cur) return;
  const key = planItemKey(kind, id);
  const next = cur.filter((i) => planItemKey(i.kind, i.id) !== key);
  if (next.length !== cur.length) setItems(prId, next);
}

export function has(prId: number, kind: PlanItem['kind'], id: string): boolean {
  const cur = plans.get(prId);
  if (!cur) return false;
  const key = planItemKey(kind, id);
  return cur.some((i) => planItemKey(i.kind, i.id) === key);
}

/** Toggle membership. Returns the new membership state (true = in plan). */
export function toggle(prId: number, item: PlanItem): boolean {
  if (has(prId, item.kind, item.id)) {
    remove(prId, item.kind, item.id);
    return false;
  }
  add(prId, item);
  return true;
}

/** Set (or clear) the annotation on an existing item. No-op if absent. */
export function annotate(
  prId: number,
  kind: PlanItem['kind'],
  id: string,
  annotation: string
): void {
  const cur = plans.get(prId);
  if (!cur) return;
  const key = planItemKey(kind, id);
  const idx = cur.findIndex((i) => planItemKey(i.kind, i.id) === key);
  if (idx < 0) return;
  const trimmed = annotation.trim();
  const next = cur.slice();
  const updated = { ...next[idx] };
  if (trimmed) updated.annotation = trimmed;
  else delete updated.annotation;
  next[idx] = updated;
  setItems(prId, next);
}

export function list(prId: number): PlanItem[] {
  return plans.get(prId) ?? [];
}

export function count(prId: number): number {
  return plans.get(prId)?.length ?? 0;
}

/** Clear a PR's plan (called after a successful checkout). */
export function clear(prId: number): void {
  if (plans.has(prId)) setItems(prId, []);
}

/** Test-only: drop all plans and notify subscribers. */
export function __resetPlanStoreForTest(): void {
  plans = new Map();
  notify();
}

// ── Hook ─────────────────────────────────────────────────────────

export function usePlanStore() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  return {
    snapshot,
    add,
    remove,
    has,
    toggle,
    annotate,
    list,
    count,
    clear,
  };
}
