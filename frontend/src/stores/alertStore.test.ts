import { beforeEach, describe, expect, it } from "vitest";

import { ALERT_PAGE_SIZE_OPTIONS, useAlertStore } from "@/stores/alertStore";
import type { Alert, AlertSeverity } from "@/types/alerts";
import { paginate } from "@/utils/pagination";
import { resetIdCounters } from "@/utils/ids";

const NOW = Date.UTC(2026, 3, 1, 12, 0, 0);

function alert(index: number, severity: AlertSeverity = "warning"): Alert {
  return {
    id: `alr-${index}`,
    deviceId: `LAG-${1000 + index}`,
    deviceName: `Device ${index}`,
    severity,
    status: "active",
    title: `Alert ${index}`,
    message: "Threshold exceeded",
    source: "threshold",
    metric: "temperature",
    value: 40 + index,
    threshold: 35,
    createdAt: NOW - index * 1000,
    updatedAt: NOW - index * 1000,
    dedupeKey: `LAG-${1000 + index}:temperature:${severity}`,
  };
}

/** Seeds `count` open alerts through the normal ingest path. */
function seed(count: number): void {
  const store = useAlertStore.getState();
  for (let index = 0; index < count; index += 1) {
    store.ingestCreated(alert(index));
  }
}

beforeEach(() => {
  resetIdCounters();
  useAlertStore.getState().reset();
});

describe("alert store paging", () => {
  it("starts on the first page with a sane default size", () => {
    const state = useAlertStore.getState();
    expect(state.page).toBe(0);
    expect(ALERT_PAGE_SIZE_OPTIONS).toContain(state.pageSize);
  });

  it("pages through the open alerts", () => {
    seed(60);
    const { open, pageSize } = useAlertStore.getState();
    expect(open).toHaveLength(60);

    const first = paginate(open, 0, pageSize);
    const second = paginate(open, 1, pageSize);

    expect(first.items).toHaveLength(pageSize);
    expect(first.pageCount).toBe(Math.ceil(60 / pageSize));
    // No overlap between consecutive pages.
    const firstIds = new Set(first.items.map((entry) => entry.id));
    expect(second.items.some((entry) => firstIds.has(entry.id))).toBe(false);
  });

  /**
   * The bug this guards against: filtering down to a handful of alerts while
   * parked on page 3 would otherwise leave the operator staring at an empty
   * table and assuming nothing matched.
   */
  it("returns to the first page whenever a filter changes", () => {
    seed(60);
    const store = useAlertStore.getState();

    store.setPage(2);
    expect(useAlertStore.getState().page).toBe(2);

    store.setFilters({ severities: ["critical"] });
    expect(useAlertStore.getState().page).toBe(0);
  });

  it("returns to the first page when filters are reset", () => {
    seed(60);
    useAlertStore.getState().setPage(2);
    useAlertStore.getState().resetFilters();
    expect(useAlertStore.getState().page).toBe(0);
  });

  it("returns to the first page when the page size changes", () => {
    seed(60);
    useAlertStore.getState().setPage(2);
    useAlertStore.getState().setPageSize(100);

    const state = useAlertStore.getState();
    expect(state.page).toBe(0);
    expect(state.pageSize).toBe(100);
  });

  it("never stores a negative page index", () => {
    useAlertStore.getState().setPage(-3);
    expect(useAlertStore.getState().page).toBe(0);
  });

  it("clears paging on reset", () => {
    seed(30);
    useAlertStore.getState().setPage(1);
    useAlertStore.getState().reset();

    const state = useAlertStore.getState();
    expect(state.page).toBe(0);
    expect(state.open).toHaveLength(0);
  });

  /**
   * Resolving alerts shrinks the list underneath a stale page index. The store
   * keeps the index as-is; `paginate` is what guarantees the operator still
   * lands on real rows.
   */
  it("still shows real rows when the list shrinks under a stale page", () => {
    seed(60);
    const store = useAlertStore.getState();
    store.setPage(2);

    // Resolve all but four.
    const ids = useAlertStore
      .getState()
      .open.slice(4)
      .map((entry) => entry.id);
    store.bulkResolve(ids);

    const state = useAlertStore.getState();
    expect(state.open).toHaveLength(4);

    const view = paginate(state.open, state.page, state.pageSize);
    expect(view.page).toBe(0);
    expect(view.items).toHaveLength(4);
    expect(view.from).toBe(1);
  });

  it("keeps a bulk selection valid across pages", () => {
    seed(60);
    const state = useAlertStore.getState();

    // Ids spanning the whole result set, not just one page.
    const everyId = state.open.map((entry) => entry.id);
    state.bulkAcknowledge(everyId, "ops.engineer");

    const acknowledged = useAlertStore
      .getState()
      .open.filter((entry) => entry.status === "acknowledged");
    expect(acknowledged).toHaveLength(60);
  });
});
