"use client";

import { useCallback, useMemo } from "react";

import {
  cancelCommand,
  issueBulkCommand,
  issueCommand,
} from "@/services/platform/platform";
import {
  selectBatchProgress,
  useCommandStore,
  type BatchProgress,
} from "@/stores/commandStore";
import type { CommandCounts, CommandType, DeviceCommand } from "@/types/commands";
import { COMMAND_LIFECYCLE, TERMINAL_COMMAND_STATUSES } from "@/types/commands";

export function useCommandCounts(): CommandCounts {
  return useCommandStore((state) => state.counts);
}

export function useCommands(limit = 100): readonly DeviceCommand[] {
  const commands = useCommandStore((state) => state.commands);
  return useMemo(() => commands.slice(0, limit), [commands, limit]);
}

export function useDeviceCommands(
  deviceId: string | null | undefined,
  limit = 25,
): readonly DeviceCommand[] {
  const commands = useCommandStore((state) => state.commands);
  return useMemo(() => {
    if (!deviceId) return [];
    const matched: DeviceCommand[] = [];
    for (const command of commands) {
      if (command.deviceId !== deviceId) continue;
      matched.push(command);
      if (matched.length >= limit) break;
    }
    return matched;
  }, [commands, deviceId, limit]);
}

/** Commands still in flight — drives the "n pending" indicator. */
export function useInFlightCommands(): readonly DeviceCommand[] {
  const commands = useCommandStore((state) => state.commands);
  return useMemo(
    () => commands.filter((command) => !TERMINAL_COMMAND_STATUSES.includes(command.status)),
    [commands],
  );
}

export function useBatchProgress(batchId: string | null): BatchProgress | null {
  return useCommandStore((state) =>
    batchId ? selectBatchProgress(state, batchId) : null,
  );
}

export interface CommandActions {
  readonly send: (deviceId: string, type: CommandType) => string;
  readonly sendBulk: (deviceIds: readonly string[], type: CommandType) => string;
  readonly cancel: (commandId: string) => boolean;
}

export function useCommandActions(): CommandActions {
  return useMemo(
    () => ({
      send: (deviceId: string, type: CommandType) => issueCommand({ deviceId, type }),
      sendBulk: (deviceIds: readonly string[], type: CommandType) =>
        issueBulkCommand({ deviceIds, type }),
      cancel: cancelCommand,
    }),
    [],
  );
}

/** Pre-bound actions for a single device's command panel. */
export function useDeviceCommandActions(deviceId: string): {
  send: (type: CommandType) => string;
} {
  const actions = useCommandActions();
  return {
    send: useCallback((type: CommandType) => actions.send(deviceId, type), [
      actions,
      deviceId,
    ]),
  };
}

/**
 * Position of a command within its lifecycle, 0-1.
 *
 * Used by the progress indicator in the command console. Failed and timed-out
 * commands report full progress — they are finished, just not successfully.
 */
export function commandProgress(command: DeviceCommand): number {
  if (TERMINAL_COMMAND_STATUSES.includes(command.status)) return 1;
  const index = COMMAND_LIFECYCLE.indexOf(command.status);
  if (index < 0) return 0;
  return (index + 1) / COMMAND_LIFECYCLE.length;
}
