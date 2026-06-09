import type { ESRDomainPack, ESRPackExpansion, ESRPackValidationResult } from "./types.js";

export interface ESRPackApplyPlan {
  entities: ESRPackExpansion["entities"];
  relations: ESRPackExpansion["relations"];
  artifacts: ESRPackExpansion["artifacts"];
  constraints: ESRPackExpansion["constraints"];
  checks: ESRPackExpansion["checks"];
  referenceBaselines: ESRPackExpansion["referenceBaselines"];
  evaluations: ESRPackValidationResult["evaluations"];
  memoryRefs: ESRPackValidationResult["memoryRefs"];
  gaps: ESRPackValidationResult["gaps"];
  baselineDiffs: ESRPackValidationResult["baselineDiffs"];
  reviewFindings: ESRPackValidationResult["reviewFindings"];
  remediationItems: ESRPackValidationResult["remediationItems"];
  summary?: string;
}

export function buildPackApplyPlan(
  expansion: ESRPackExpansion,
  validation?: ESRPackValidationResult,
): ESRPackApplyPlan {
  return {
    entities: expansion.entities,
    relations: expansion.relations,
    artifacts: expansion.artifacts,
    constraints: [
      ...expansion.constraints,
      ...(validation?.constraints ?? []),
    ],
    checks: expansion.checks ?? [],
    referenceBaselines: expansion.referenceBaselines ?? [],
    evaluations: validation?.evaluations ?? [],
    memoryRefs: validation?.memoryRefs ?? [],
    gaps: validation?.gaps ?? [],
    baselineDiffs: validation?.baselineDiffs ?? [],
    reviewFindings: validation?.reviewFindings ?? [],
    remediationItems: validation?.remediationItems ?? [],
    summary: validation?.summary ?? expansion.summary,
  };
}

export async function detectBestPack(
  packs: ESRDomainPack[],
  input: Parameters<ESRDomainPack["detect"]>[0],
): Promise<{ pack: ESRDomainPack | null; score: number }> {
  let bestPack: ESRDomainPack | null = null;
  let bestScore = 0;

  for (const pack of packs) {
    const score = await pack.detect(input);
    if (score > bestScore) {
      bestPack = pack;
      bestScore = score;
    }
  }

  return { pack: bestPack, score: bestScore };
}
