import type {
  ESRDomainPack,
  ESRPackExpansion,
  ESRPackValidationResult,
} from "../../domain-pack/src/index.js";

export const softwarePack: ESRDomainPack = {
  name: "software",
  version: "0.1.0",
  description: "Default software engineering pack for tasks, code artifacts, and quality constraints.",

  async detect(input) {
    const text = input.prompt.toLowerCase();
    if (/(refactor|bug|test|typescript|ts|api|module|build|code)/.test(text)) {
      return 0.85;
    }
    return 0.2;
  },

  async expand(input): Promise<ESRPackExpansion> {
    return {
      entities: [
        {
          entity_id: "task-main",
          role: "Task",
          state: "draft",
          label: input.goal,
          confidence: 0.5,
        },
      ],
      relations: [],
      artifacts: [],
      constraints: [
        {
          entity_id: "task-main",
          description: "must pass typecheck",
        },
        {
          entity_id: "task-main",
          description: "must pass tests when available",
        },
      ],
      summary: "Software pack initialized a default engineering task scaffold.",
    };
  },

  async validate(_input): Promise<ESRPackValidationResult> {
    return {
      evaluations: [],
      constraints: [],
      memoryRefs: [],
      gaps: [],
      summary: "Software pack validation is not yet implemented.",
    };
  },
};
