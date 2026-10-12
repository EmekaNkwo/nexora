import { create } from "zustand";

import type { CommandCounts, DeviceCommand } from "@/types/commands";
import { EMPTY_COMMAND_COUNTS, TERMINAL_COMMAND_STATUSES } from "@/types/commands";

/** Commands retained in the console. Older ones would never be read. */
const HISTORY_LIMIT = 500;

export interface CommandStoreState {
  readonly commands: readonly DeviceCommand[];
  readonly byId: ReadonlyMap<string, DeviceCommand>;
  readonly counts: CommandCounts;
  /** Batch id → command ids, so bulk progress is O(1) to look up. */
  readonly batches: ReadonlyMap<string, readonly string[]>;
  readonly version: number;

  ingest: (command: DeviceCommand) => void;
  clear: () => void;
}

function countCommands(commands: readonly DeviceCommand[]): CommandCounts {
  let queued = 0;
  let inFlight = 0;
  let completed = 0;
  let failed = 0;

  for (const command of commands) {
    switch (command.status) {
      case "queued":
        queued += 1;
        break;
      case "sent":
      case "acknowledged":
        inFlight += 1;
        break;
      case "completed":
        completed += 1;
        break;
      default:
        failed += 1;
    }
  }

  return { queued, inFlight, completed, failed, total: commands.length };
}

export const useCommandStore = create<CommandStoreState>((set, get) => ({
  commands: [],
  byId: new Map(),
  counts: EMPTY_COMMAND_COUNTS,
  batches: new Map(),
  version: 0,

  /**
   * Upserts a command. Every lifecycle transition arrives through here, so the
   * list is keyed by id and the existing entry is replaced in place — a
   * command must not move in the console as it progresses.
   */
  ingest: (command) => {
    const state = get();
    const index = state.commands.findIndex((entry) => entry.id === command.id);

    let commands: DeviceCommand[];
    if (index >= 0) {
      commands = [...state.commands];
      commands[index] = command;
    } else {
      commands = [command, ...state.commands].slice(0, HISTORY_LIMIT);
    }

    const byId = new Map<string, DeviceCommand>();
    for (const entry of commands) byId.set(entry.id, entry);

    let batches = state.batches;
    if (command.batchId && index < 0) {
      const next = new Map(state.batches);
      const existing = next.get(command.batchId) ?? [];
      next.set(command.batchId, [...existing, command.id]);
      batches = next;
    }

    set({
      commands,
      byId,
      batches,
      counts: countCommands(commands),
      version: state.version + 1,
    });
  },

  clear: () =>
    set((state) => ({
      commands: [],
      byId: new Map(),
      batches: new Map(),
      counts: EMPTY_COMMAND_COUNTS,
      version: state.version + 1,
    })),
}));

export interface BatchProgress {
  readonly total: number;
  readonly settled: number;
  readonly completed: number;
  readonly failed: number;
  readonly progress: number;
}

/** Progress of one bulk action, derived rather than stored. */
export function selectBatchProgress(
  state: CommandStoreState,
  batchId: string,
): BatchProgress {
  const ids = state.batches.get(batchId) ?? [];
  let completed = 0;
  let failed = 0;

  for (const id of ids) {
    const command = state.byId.get(id);
    if (!command) continue;
    if (command.status === "completed") completed += 1;
    else if (TERMINAL_COMMAND_STATUSES.includes(command.status)) failed += 1;
  }

  const settled = completed + failed;
  return {
    total: ids.length,
    settled,
    completed,
    failed,
    progress: ids.length === 0 ? 0 : settled / ids.length,
  };
}

export function selectDeviceCommands(
  state: CommandStoreState,
  deviceId: string,
): readonly DeviceCommand[] {
  return state.commands.filter((command) => command.deviceId === deviceId);
}
