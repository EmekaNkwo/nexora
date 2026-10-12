/**
 * Adapts Base UI's `Select.onValueChange` to a non-nullable handler.
 *
 * Base UI emits `string | null` because a select can be cleared. None of the
 * selects in this console are clearable — each one always has a valid choice —
 * so rather than widening every piece of state to accept `null`, the null is
 * dropped here once.
 */
export function onSelect<T extends string>(
  handler: (value: T) => void,
): (value: string | null) => void {
  return (value) => {
    if (value === null) return;
    handler(value as T);
  };
}
