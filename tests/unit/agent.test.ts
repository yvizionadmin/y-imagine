import { describe, expect, it } from "vitest";
import { demoSearchTerms } from "@/lib/ai/providers/demo-text";
import { AGENT_GOAL_MAX, AGENT_TOOL_CALLS, appendText, cleanGoal, guessCategory, type AgentStep } from "@/lib/agent/limits";
import { agentSystemPrompt } from "@/lib/agent/prompt";

describe("agent helpers", () => {
  it("cleans a goal and refuses empty or long ones", () => {
    expect(cleanGoal("  Find the sofa \r\n and write copy ")).toBe("Find the sofa \n and write copy");
    expect(cleanGoal("   ")).toBeNull();
    expect(cleanGoal(42)).toBeNull();
    expect(cleanGoal("x".repeat(AGENT_GOAL_MAX + 1))).toBeNull();
  });

  it("works out a preset category from a catalog path and name", () => {
    expect(guessCategory("Living Room > Sofas Grey Fabric 3-Seater Sofa")).toBe("furniture");
    expect(guessCategory("Kitchen > Coffee Machines Espresso maker")).toBe("kitchenAppliances");
    expect(guessCategory("Bath > Faucets Chrome mixer tap")).toBe("bathroom");
    expect(guessCategory("Women > Dresses Linen midi dress")).toBe("fashion");
    // Nothing recognisable: the first preset.
    expect(guessCategory("Misc thing")).toBe("furniture");
  });

  it("joins text pieces onto the last text step, and starts a new one after a tool", () => {
    let n = 0;
    const id = () => `s${++n}`;
    let steps: AgentStep[] = [];
    steps = appendText(steps, "Looking ", id).steps;
    const joined = appendText(steps, "now.", id);
    expect(joined.stepId).toBe("s1");
    steps = [...joined.steps, { id: "call", kind: "tool", tool: "search_catalog", status: "ok", label: "sofa", output: null, error: null }];
    const after = appendText(steps, "Done.", id);
    expect(after.stepId).toBe("s2");
    expect(after.steps.map((s) => (s.kind === "text" ? s.text : s.kind))).toEqual(["Looking now.", "tool", "Done."]);
  });

  it("tells the model its tools, their limits and to stay within the catalog", () => {
    const prompt = agentSystemPrompt({ orgName: "Acme Home", today: "2026-11-10" });
    expect(prompt).toContain("Acme Home");
    expect(prompt).toContain(`generate_image ${AGENT_TOOL_CALLS.generate_image} times`);
    expect(prompt).toContain("search_catalog before");
    expect(prompt).toContain("never invent");
    expect(prompt).toContain("Today is 2026-11-10.");
  });

  it("picks catalog searches for the offline agent from the goal", () => {
    expect(demoSearchTerms("Find the grey sofa and write copy")).toEqual(["grey", "sofa"]);
    expect(demoSearchTerms("Make an image of CHAIR-OAK-99 please")).toEqual(["CHAIR-OAK-99"]);
    expect(demoSearchTerms("Write copy for the armchairs")).toEqual(["armchair"]);
  });
});
