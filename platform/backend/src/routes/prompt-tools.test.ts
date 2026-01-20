import ProfileModel from "@/models/profile";
import PromptModel from "@/models/prompt";
import PromptAgentModel from "@/models/prompt-agent";
import ToolModel from "@/models/tool";
import { describe, expect, test } from "@/test";

describe("GET /api/prompts/:id/tools", () => {
  test("returns agent delegation tools for a prompt", async ({
    makeOrganization,
    makeUser,
    makeTeam,
  }) => {
    const org = await makeOrganization();
    const user = await makeUser({ email: "test@example.com" });
    const team = await makeTeam(org.id, user.id, { name: "Test Team" });

    // Create parent profile and prompt
    const parentProfile = await ProfileModel.create({
      name: "Parent Profile",
      teams: [team.id],
    });

    const parentPrompt = await PromptModel.create(org.id, {
      name: "Parent Prompt",
      profileId: parentProfile.id,
    });

    // Create child profile and prompt
    const childProfile = await ProfileModel.create({
      name: "Child Profile",
      teams: [team.id],
    });

    const childPrompt = await PromptModel.create(org.id, {
      name: "Child Prompt",
      profileId: childProfile.id,
      systemPrompt: "I am a child agent",
    });

    // Assign child prompt as agent to parent prompt
    await PromptAgentModel.create({
      promptId: parentPrompt.id,
      agentPromptId: childPrompt.id,
    });

    // Verify tool was created
    const tools = await ToolModel.getProfileDelegationToolsByPrompt(
      parentPrompt.id,
    );
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("agent__child_prompt");

    // Verify the detailed query also works
    const toolsWithDetails =
      await ToolModel.getProfileDelegationToolsWithDetails(parentPrompt.id);
    expect(toolsWithDetails).toHaveLength(1);
    expect(toolsWithDetails[0].profileId).toBe(childProfile.id);
  });
});
