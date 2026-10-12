"use client";

import { useId, type ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { onSelect } from "@/components/shared/selectValue";
import { cn } from "@/lib/utils";

/**
 * Form field primitives.
 *
 * Every form in the console was repeating the same five lines — a `Label`, a
 * control, a hint paragraph, and the wiring between them. Repetition is the
 * lesser problem; the real one is that each copy was free to get the details
 * wrong, and several did:
 *
 * - **Width.** `SelectTrigger` is `w-fit` by default, so a select next to an
 *   input in the same grid cell rendered narrower than it, and the form looked
 *   misaligned. Controls here are always full width.
 * - **Labels.** Base UI's `Select.Value` renders the raw *value* unless the
 *   root is given an `items` map, so triggers read "metric" and ">" while the
 *   popup read "Metric value" and "> greater than". `SelectField` builds that
 *   map from the same `options` it renders, so the two cannot disagree.
 * - **Association.** Hints were often loose `<p>` tags with no
 *   `aria-describedby`, so a screen reader never read them with the control.
 *   Ids are generated and wired here.
 */

export interface FieldProps {
  readonly label: string;
  /** Helper text, read with the control. */
  readonly hint?: ReactNode;
  /** Replaces the hint and marks the control invalid. */
  readonly error?: string | null;
  readonly className?: string;
  /** Visually hides the label while keeping it for assistive tech. */
  readonly hideLabel?: boolean;
}

interface FieldShellProps extends FieldProps {
  readonly controlId: string;
  readonly describedById: string;
  readonly children: ReactNode;
}

function FieldShell({
  label,
  hint,
  error,
  className,
  hideLabel,
  controlId,
  describedById,
  children,
}: FieldShellProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={controlId} className={cn("ops-label", hideLabel && "sr-only")}>
        {label}
      </Label>
      {children}
      {error ? (
        <p id={describedById} className="text-[0.7rem] text-status-critical" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={describedById} className="text-[0.7rem] text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface TextFieldProps extends FieldProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly type?: "text" | "number";
  readonly min?: number;
  readonly step?: number;
  readonly disabled?: boolean;
  /** Extra classes for the input itself, e.g. `ops-mono uppercase`. */
  readonly inputClassName?: string;
}

export function TextField({
  value,
  onChange,
  placeholder,
  type = "text",
  min,
  step,
  disabled,
  inputClassName,
  ...field
}: TextFieldProps) {
  const id = useId();
  const describedById = `${id}-hint`;
  const described = field.error || field.hint ? describedById : undefined;

  return (
    <FieldShell {...field} controlId={id} describedById={describedById}>
      <Input
        id={id}
        type={type}
        min={min}
        step={step}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-invalid={Boolean(field.error)}
        aria-describedby={described}
        className={cn("h-8 w-full text-xs", inputClassName)}
      />
    </FieldShell>
  );
}

export interface SelectOption<T extends string> {
  readonly value: T;
  readonly label: string;
  /** Shown after the label, muted — e.g. a channel or a group kind. */
  readonly meta?: string;
}

export interface SelectFieldProps<T extends string> extends FieldProps {
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly options: readonly SelectOption<T>[];
  readonly disabled?: boolean;
}

export function SelectField<T extends string>({
  value,
  onChange,
  options,
  disabled,
  ...field
}: SelectFieldProps<T>) {
  const id = useId();
  const describedById = `${id}-hint`;
  const described = field.error || field.hint ? describedById : undefined;

  // Derived from the same options the popup renders, so the trigger can never
  // show a different label — or a raw value — from the list.
  const items: Record<string, string> = Object.fromEntries(
    options.map((option) => [option.value, option.label]),
  );

  return (
    <FieldShell {...field} controlId={id} describedById={describedById}>
      <Select items={items} value={value} onValueChange={onSelect<T>(onChange)} disabled={disabled}>
        <SelectTrigger
          id={id}
          className="h-8 w-full text-xs"
          aria-invalid={Boolean(field.error)}
          aria-describedby={described}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
              {option.meta ? (
                <span className="ml-2 text-muted-foreground">{option.meta}</span>
              ) : null}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldShell>
  );
}

export interface TextAreaFieldProps extends FieldProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly rows?: number;
}

export function TextAreaField({
  value,
  onChange,
  placeholder,
  rows = 3,
  ...field
}: TextAreaFieldProps) {
  const id = useId();
  const describedById = `${id}-hint`;
  const described = field.error || field.hint ? describedById : undefined;

  return (
    <FieldShell {...field} controlId={id} describedById={describedById}>
      <Textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={rows}
        aria-invalid={Boolean(field.error)}
        aria-describedby={described}
        className="w-full text-xs"
      />
    </FieldShell>
  );
}
