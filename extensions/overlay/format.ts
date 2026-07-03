/**
 * esr-overlay format — view functions for rendering overlay nodes.
 *
 * Adapted from rpiv-todo's view/format.ts, extended for graph structure:
 * - Root task nodes use status glyphs
 * - Children use relation-type icons and dim styling
 * - Indentation with tree connectors (├─, └─)
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { OverlayNode } from "./selectors.js";

// ═══════════════════════════════════════════════════════════
// Status glyphs
// ═══════════════════════════════════════════════════════════

const STATE_GLYPH: Record<string, { glyph: string; color: "dim" | "warning" | "success" | "error" | "accent" }> = {
  active:     { glyph: "◐", color: "warning" },
  blocked:    { glyph: "⊘", color: "error" },
  draft:      { glyph: "○", color: "dim" },
  stable:     { glyph: "✓", color: "success" },
  deprecated: { glyph: "✗", color: "dim" },
};

const DEFAULT_GLYPH = { glyph: "·", color: "dim" as const };

// ═══════════════════════════════════════════════════════════
// Formatting
// ═══════════════════════════════════════════════════════════

/**
 * Format a root task node line.
 * Example: "◐ task-esr-overlay Add overlay widget"
 */
export function formatRootNode(node: OverlayNode, theme: Theme, showId: boolean): string {
  const g = STATE_GLYPH[node.state] ?? DEFAULT_GLYPH;
  const glyph = theme.fg(g.color, g.glyph);

  const subjectColor = (node.state === "stable" || node.state === "deprecated") ? "dim" : "text";
  let subject = theme.fg(subjectColor, node.label);
  if (node.state === "stable" || node.state === "deprecated") {
    subject = theme.strikethrough(subject);
  }

  let line = glyph;
  if (showId && node.entityId) {
    line += ` ${theme.fg("accent", node.entityId)}`;
  }
  line += ` ${subject}`;

  // Confidence badge when not 1.0
  if (node.confidence > 0 && node.confidence < 1.0) {
    line += ` ${theme.fg("dim", `(${Math.round(node.confidence * 100)}%)`)}`;
  }

  // Closure badge
  if (node.isReadyForStable && node.state !== "stable") {
    line += ` ${theme.fg("success", "ready")}`;
  }

  return line;
}

/**
 * Format a child (relation) node line.
 * Example: "  ├─ ⚡ constraint-task-main must pass tests"
 */
export function formatChildNode(node: OverlayNode, _theme: Theme, isLast: boolean, prefix: string): string {
  const connector = isLast ? "└─" : "├─";
  const relGlyph = node.relationLabel ?? "·";

  let line = `${prefix}${connector} ${relGlyph} `;
  line += `${node.label}`;

  if (node.entityId && node.role !== "relation") {
    line += ` [${node.role}]`;
  }

  return line;
}

/**
 * Format state for summary line.
 */
export function formatStateLabel(state: string): string {
  const labels: Record<string, string> = {
    active: "active",
    blocked: "blocked",
    draft: "draft",
    stable: "completed",
    deprecated: "deprecated",
  };
  return labels[state] ?? state;
}

/**
 * Format node for the /esr overlay — dispatches by indent level
 */
export function formatOverlayNode(
  node: OverlayNode,
  theme: Theme,
  showId: boolean,
  isLastChild: boolean,
  parentConnectors: string,
): string {
  if (node.indent === 0) {
    return formatRootNode(node, theme, showId);
  }
  return formatChildNode(node, theme, isLastChild, parentConnectors);
}