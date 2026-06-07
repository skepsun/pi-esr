import { describe, expect, it } from "vitest";
import { getCurrentSessionId, setCurrentSessionId } from "@pi-esr/core";

describe("Session state", () => {
  it("starts with null session id", () => {
    expect(getCurrentSessionId()).toBeNull();
  });

  it("stores and retrieves session id", () => {
    setCurrentSessionId("sess-abc-123");
    expect(getCurrentSessionId()).toBe("sess-abc-123");
  });

  it("can be reset to null", () => {
    setCurrentSessionId("sess-abc-123");
    setCurrentSessionId(null);
    expect(getCurrentSessionId()).toBeNull();
  });
});
