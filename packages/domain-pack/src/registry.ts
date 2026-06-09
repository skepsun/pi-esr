import type { ESRDomainPack } from "./types.js";

export class ESRDomainPackRegistry {
  private readonly packs = new Map<string, ESRDomainPack>();

  register(pack: ESRDomainPack): void {
    this.packs.set(pack.name, pack);
  }

  get(name: string): ESRDomainPack | undefined {
    return this.packs.get(name);
  }

  list(): ESRDomainPack[] {
    return [...this.packs.values()].sort((left, right) => left.name.localeCompare(right.name));
  }
}
