import { govdocPack } from "../../domain-pack-govdoc/src/index.js";
import { planningReviewPack } from "../../domain-pack-planning-review/src/index.js";
import { softwarePack } from "../../domain-pack-software/src/index.js";
import { ESRDomainPackRegistry } from "./registry.js";

export function createBuiltinPackRegistry(): ESRDomainPackRegistry {
  const registry = new ESRDomainPackRegistry();
  registry.register(planningReviewPack);
  registry.register(softwarePack);
  registry.register(govdocPack);
  return registry;
}
