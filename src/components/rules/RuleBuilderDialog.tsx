"use client";

import { RuleBuilder } from "@/components/rules/RuleBuilder";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Rule, RuleDraft } from "@/types/rules";

/**
 * Rule builder in a modal.
 *
 * Creating a rule used to replace the whole page, which cost the operator the
 * context they were working from — the rule list and, more importantly, the
 * execution log showing what the existing rules were doing. Authoring a rule is
 * a focused, cancellable side task, which is exactly what a modal is for.
 *
 * The dialog owns the chrome: title, description and the close affordance. The
 * builder owns its own scrolling body and pinned action bar, so it expands to
 * whatever height the dialog allows and never pushes Create off-screen.
 */
export interface RuleBuilderDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Existing rule to edit; omit to create. */
  readonly rule?: Rule;
  readonly onSave: (draft: RuleDraft) => void;
}

export function RuleBuilderDialog({
  open,
  onOpenChange,
  rule,
  onSave,
}: RuleBuilderDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        Wider than the default `sm:max-w-sm` because the builder is a
        two-column layout — a condition row alone needs five controls side by
        side, and squeezing it into a narrow modal would wrap every row.

        `max-h-[88dvh]` with `flex` is what makes the pinned footer work: the
        dialog is bounded, the builder fills it, and only the builder's body
        scrolls. `dvh` rather than `vh` so a mobile browser's collapsing
        address bar does not push the action bar out of reach.
      */}
      <DialogContent className="flex max-h-[88dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="shrink-0 space-y-1 border-b border-border px-4 py-3 text-left">
          <DialogTitle className="text-sm font-semibold tracking-tight">
            {rule ? "Edit rule" : "New rule"}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Conditions are evaluated against every telemetry frame for devices in scope.
          </DialogDescription>
        </DialogHeader>

        {/*
          Remounted per rule id, so opening the dialog for a different rule
          starts from that rule's values. The builder seeds its draft state
          once from the `rule` prop; without the key it would keep the draft
          from whichever rule was opened first.
        */}
        <RuleBuilder
          key={rule?.id ?? "new"}
          rule={rule}
          onCancel={() => onOpenChange(false)}
          onSave={onSave}
        />
      </DialogContent>
    </Dialog>
  );
}
