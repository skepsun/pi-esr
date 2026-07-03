/**
 * esr-overlay widget — Persistent above-editor widget showing ESR graph state.
 *
 * Lifecycle modeled after rpiv-todo's todo-overlay.ts:
 * - setWidget with placement: "aboveEditor"
 * - register-once + requestRender() refresh
 * - 12-line collapse-not-scroll + trailing spacer
 * - auto-hide when no entities exist
 * - completed (stable) tasks auto-hide on next agent_start
 *
 * Graph-aware rendering:
 * - Each Task is a root node with status glyphs
 * - Related constraints, artifacts, evaluators shown as children indented under tasks
 * - Subtree-aware truncation: whole task subtrees are collapsed, never mid-broken
 */

import type { ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { ESRGraph } from "../../packages/core/src/graph.js";
import { formatOverlayNode } from "./format.js";
import {
  selectCounts,
  selectHasActive,
  selectOverlayLayout,
  selectOverlayState,
  type OverlayNode,
  type OverlayState,
} from "./selectors.js";

const WIDGET_KEY = "esr-tasks";

/**
 * Max overlay lines. Overridable via PI_ESR_OVERLAY_MAX_LINES env var.
 * Reduce to 4-6 when coexisting with rpiv-todo (which also uses
 * placement: "aboveEditor" with key "rpiv-todos"). Both widgets
 * stack vertically — different keys, no collision.
 */
const MAX_WIDGET_LINES = (() => {
  const env = parseInt(process.env.PI_ESR_OVERLAY_MAX_LINES ?? "", 10);
  return env > 0 ? env : 12;
})();

const OVERLAY_HEADING = "ESR";
const OVERLAY_MORE = "more";

export class ESROverlay {
  private uiCtx: ExtensionUIContext | undefined;
  private widgetRegistered = false;
  private tui: any | undefined;
  private graph: ESRGraph;

  // Completed display lifecycle — identical to rpiv-todo's pattern
  private stableTaskIdsPendingHide = new Set<string>();
  private hiddenStableTaskIds = new Set<string>();
  private lastVersion: number | undefined;
  private maxLines: number;

  constructor(graph: ESRGraph) {
    this.graph = graph;
    this.maxLines = MAX_WIDGET_LINES;
  }

  setUICtx(ctx: ExtensionUIContext): void {
    if (ctx !== this.uiCtx) {
      this.uiCtx = ctx;
      this.widgetRegistered = false;
      this.tui = undefined;
    }
  }

  // ── Public lifecycle ─────────────────────────────────

  /** Dynamically reduce max lines (e.g., when rpiv-todo coexists). */
  setMaxLines(n: number): void {
    this.maxLines = Math.max(2, n);
    this.widgetRegistered = false; // force re-register on next update
    this.update();
  }

  update(): void {
    if (!this.uiCtx) return;
    const snapshot = selectOverlayState(this.graph);

    if (snapshot.nodes.length === 0) {
      if (this.widgetRegistered) {
        this.uiCtx.setWidget(WIDGET_KEY, undefined);
        this.widgetRegistered = false;
        this.tui = undefined;
      }
      return;
    }

    if (!this.widgetRegistered) {
      this.uiCtx.setWidget(
        WIDGET_KEY,
        (tui: any, theme: Theme) => {
          this.tui = tui;
          return {
            render: (width: number) => this.renderWidget(theme, width),
            invalidate: () => {
              this.widgetRegistered = false;
              this.tui = undefined;
            },
          };
        },
        { placement: "aboveEditor" },
      );
      this.widgetRegistered = true;
    } else {
      this.tui?.requestRender();
    }
  }

  resetCompletedDisplayState(): void {
    this.stableTaskIdsPendingHide.clear();
    this.hiddenStableTaskIds.clear();
    this.lastVersion = undefined;
  }

  hideCompletedTasksFromPreviousTurn(): void {
    if (this.stableTaskIdsPendingHide.size === 0) return;
    for (const taskId of this.stableTaskIdsPendingHide) {
      this.hiddenStableTaskIds.add(taskId);
    }
    this.stableTaskIdsPendingHide.clear();
    this.tui?.requestRender();
  }

  dispose(): void {
    if (this.uiCtx) this.uiCtx.setWidget(WIDGET_KEY, undefined);
    this.widgetRegistered = false;
    this.tui = undefined;
    this.uiCtx = undefined;
    this.resetCompletedDisplayState();
  }

  // ── Internal ─────────────────────────────────────────

  private getSnapshot(): OverlayState {
    const currentVersion = this.graph.getVersion();
    if (this.lastVersion !== undefined && currentVersion < this.lastVersion) {
      this.resetCompletedDisplayState();
    }
    this.lastVersion = currentVersion;
    return selectOverlayState(this.graph);
  }

  /** Hide stable task subtrees marked for hiding, prune stale entries. */
  private filterVisible(snapshot: OverlayState): OverlayNode[] {
    const currentStableIds = new Set(
      snapshot.nodes.filter(n => n.indent === 0 && n.state === "stable")
        .map(n => n.entityId)
        .filter((id): id is string => id != null),
    );
    for (const id of this.stableTaskIdsPendingHide) {
      if (!currentStableIds.has(id)) this.stableTaskIdsPendingHide.delete(id);
    }
    for (const id of this.hiddenStableTaskIds) {
      if (!currentStableIds.has(id)) this.hiddenStableTaskIds.delete(id);
    }

    const filtered: OverlayNode[] = [];
    let skip = false;
    for (const node of snapshot.nodes) {
      if (node.indent === 0) {
        skip = node.state === "stable" &&
          node.entityId != null &&
          this.hiddenStableTaskIds.has(node.entityId);
      }
      if (!skip) filtered.push(node);
    }
    return filtered;
  }

  private renderWidget(theme: Theme, width: number): string[] {
    const snapshot = this.getSnapshot();
    const visibleNodes = this.filterVisible(snapshot);
    if (visibleNodes.length === 0) return [];

    const visibleState: OverlayState = {
      nodes: visibleNodes,
      roleCounts: snapshot.roleCounts,
      totalEntities: snapshot.totalEntities,
    };
    const truncate = (line: string): string => truncateToWidth(line, width, "…");

    const counts = selectCounts(this.graph);
    const hasActive = selectHasActive(visibleState);
    const showIds = snapshot.nodes.some(n => n.indent === 0 && n.entityId);

    // Heading: "● ESR ◐1 ⊘0 ⚡2 📄0"
    const headingIcon = hasActive ? "●" : "○";
    const headingColor = hasActive ? "accent" : "dim";
    const headingParts: string[] = [];
    if (counts.active > 0) headingParts.push(`◐${counts.active}`);
    if (counts.blocked > 0) headingParts.push(`⊘${counts.blocked}`);
    if (counts.constraint > 0) headingParts.push(`⚡${counts.constraint}`);
    if (counts.artifact > 0) headingParts.push(`📄${counts.artifact}`);
    if (counts.concept > 0) headingParts.push(`○${counts.concept}`);
    const headingGlyphs = headingParts.length > 0
      ? headingParts.join(" ")
      : `${counts.total} entities`;
    const headingText = `${OVERLAY_HEADING} ${headingGlyphs}`;
    const heading = truncate(
      `${theme.fg(headingColor, headingIcon)} ${theme.fg(headingColor, headingText)}`,
    );

    const lines: string[] = [heading];

    // Render visible nodes with tree connectors
    const layout = selectOverlayLayout(visibleState, this.maxLines - 1);

    for (const node of layout.visible) {
      lines.push(truncate(formatOverlayNode(node, theme, showIds, false, "")));
    }

    // Track newly displayed stable tasks for pending hide
    const newlyStableIds = visibleNodes
      .filter(
        n =>
          n.indent === 0 &&
          n.state === "stable" &&
          n.entityId != null &&
          !this.stableTaskIdsPendingHide.has(n.entityId) &&
          !this.hiddenStableTaskIds.has(n.entityId),
      )
      .map(n => n.entityId!);
    for (const id of newlyStableIds) this.stableTaskIdsPendingHide.add(id);

    // Footer: summary or close
    if (layout.totalHidden === 0) {
      const last = lines.length - 1;
      lines[last] = lines[last].replace("├─", "└─");
      return this.withTrailingSpacer(lines);
    }

    const overflowParts: string[] = [];
    if (layout.hiddenStableTasks > 0) overflowParts.push(`${layout.hiddenStableTasks} completed`);
    if (layout.truncatedDraftTasks > 0) overflowParts.push(`${layout.truncatedDraftTasks} draft`);
    if (layout.truncatedChildren > 0) overflowParts.push(`${layout.truncatedChildren} more`);
    const summary = overflowParts.length > 0
      ? `+${layout.totalHidden} ${OVERLAY_MORE} (${overflowParts.join(", ")})`
      : `+${layout.totalHidden} ${OVERLAY_MORE}`;
    lines.push(truncate(`${theme.fg("dim", "└─")} ${theme.fg("dim", summary)}`));
    return this.withTrailingSpacer(lines);
  }

  private withTrailingSpacer(lines: string[]): string[] {
    if (lines.length === 0) return lines;
    lines.push("");
    return lines;
  }
}