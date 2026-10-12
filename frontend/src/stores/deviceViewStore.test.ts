import { beforeEach, describe, expect, it } from "vitest";

import { PAGE_SIZE_OPTIONS, useDeviceViewStore } from "./deviceViewStore";

/**
 * Device table paging.
 *
 * The failure mode this guards is the classic one: narrowing a filter while on
 * page 9 leaves the operator staring at a blank table and concluding the fleet
 * is empty. `paginate` clamps as a backstop, but resetting at the source is
 * what makes the page they land on the *right* one rather than merely a valid
 * one — clamping to the last page of the new result set is still not page 1.
 */

const initial = useDeviceViewStore.getState();

beforeEach(() => {
  useDeviceViewStore.setState({
    filters: initial.filters,
    page: 0,
    pageSize: 50,
    virtualised: false,
    selectedIds: new Set(),
  });
});

describe("paging defaults", () => {
  it("starts paginated rather than in continuous scroll", () => {
    expect(useDeviceViewStore.getState().virtualised).toBe(false);
  });

  it("offers a default page size that is one of the options", () => {
    expect(PAGE_SIZE_OPTIONS).toContain(useDeviceViewStore.getState().pageSize);
  });
});

describe("page reset", () => {
  /** Every mutator that can shrink the result set under the operator. */
  const narrowing: readonly { readonly name: string; readonly run: () => void }[] = [
    { name: "setSearch", run: () => useDeviceViewStore.getState().setSearch("LAG") },
    { name: "toggleStatus", run: () => useDeviceViewStore.getState().toggleStatus("offline") },
    {
      name: "toggleType",
      run: () => useDeviceViewStore.getState().toggleType("gps-tracker"),
    },
    {
      name: "toggleGroup",
      run: () => useDeviceViewStore.getState().toggleGroup("grp-energy"),
    },
    {
      name: "setHealthRange",
      run: () => useDeviceViewStore.getState().setHealthRange([20, 80]),
    },
    {
      name: "setOnlyWithAlerts",
      run: () => useDeviceViewStore.getState().setOnlyWithAlerts(true),
    },
    {
      name: "setFilters",
      run: () => useDeviceViewStore.getState().setFilters({ search: "MUC" }),
    },
    { name: "resetFilters", run: () => useDeviceViewStore.getState().resetFilters() },
  ];

  for (const { name, run } of narrowing) {
    it(`${name} returns to the first page`, () => {
      useDeviceViewStore.getState().setPage(8);
      expect(useDeviceViewStore.getState().page).toBe(8);

      run();
      expect(useDeviceViewStore.getState().page).toBe(0);
    });
  }

  it("changing page size returns to the first page", () => {
    // Row 400 on page 8 of 50 is not row 400 on page 8 of 250, so holding the
    // index would silently move the operator somewhere else in the list.
    useDeviceViewStore.getState().setPage(8);
    useDeviceViewStore.getState().setPageSize(250);

    expect(useDeviceViewStore.getState().pageSize).toBe(250);
    expect(useDeviceViewStore.getState().page).toBe(0);
  });

  it("clamps a negative page index", () => {
    useDeviceViewStore.getState().setPage(-3);
    expect(useDeviceViewStore.getState().page).toBe(0);
  });

  it("does not reset the page when sorting", () => {
    // Sorting reorders the same result set; the operator stays where they are.
    useDeviceViewStore.getState().setPage(4);
    useDeviceViewStore.getState().setSort("healthScore");
    expect(useDeviceViewStore.getState().page).toBe(4);
  });

  it("does not reset the page when selecting rows", () => {
    useDeviceViewStore.getState().setPage(4);
    useDeviceViewStore.getState().toggleSelected("LAG-1000");
    useDeviceViewStore.getState().selectMany(["LAG-1001", "LAG-1002"]);
    expect(useDeviceViewStore.getState().page).toBe(4);
  });
});

describe("selection across pages", () => {
  it("keeps selections made on other pages when adding a page", () => {
    useDeviceViewStore.getState().selectMany(["LAG-1000", "LAG-1001"]);
    useDeviceViewStore.getState().selectMany(["MUC-2000"]);

    expect([...useDeviceViewStore.getState().selectedIds].sort()).toEqual([
      "LAG-1000",
      "LAG-1001",
      "MUC-2000",
    ]);
  });

  it("selectOnly replaces the selection, for deselecting a single page", () => {
    useDeviceViewStore.getState().selectMany(["LAG-1000", "LAG-1001", "MUC-2000"]);
    // What the header checkbox does when clearing the current page: keep
    // everything that is not on it.
    useDeviceViewStore.getState().selectOnly(["MUC-2000"]);

    expect([...useDeviceViewStore.getState().selectedIds]).toEqual(["MUC-2000"]);
  });
});

describe("display mode", () => {
  it("switches between paged and continuous scroll", () => {
    useDeviceViewStore.getState().setVirtualised(true);
    expect(useDeviceViewStore.getState().virtualised).toBe(true);

    useDeviceViewStore.getState().setVirtualised(false);
    expect(useDeviceViewStore.getState().virtualised).toBe(false);
  });

  it("preserves the page index across a mode round-trip", () => {
    useDeviceViewStore.getState().setPage(3);
    useDeviceViewStore.getState().setVirtualised(true);
    useDeviceViewStore.getState().setVirtualised(false);
    expect(useDeviceViewStore.getState().page).toBe(3);
  });
});
