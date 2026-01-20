import { expect, test } from "./fixtures";

test.describe("Prompts API", () => {
  test("should maintain profile-prompt relationships when updating a prompt", async ({
    request,
    createProfile,
    makeApiRequest,
  }) => {
    // Step 1: Create a profile
    const createProfileResponse = await createProfile(
      request,
      "Profile for Prompt Update Test",
    );
    const profile = await createProfileResponse.json();

    // Step 2: Create a system prompt with profileId
    const createPromptResponse = await makeApiRequest({
      request,
      method: "post",
      urlSuffix: "/api/prompts",
      data: {
        name: "Test System Prompt",
        profileId: profile.id,
        systemPrompt: "You are a helpful assistant.",
      },
    });
    const originalPrompt = await createPromptResponse.json();

    // Verify prompt was created correctly
    expect(originalPrompt.id).toBeDefined();
    expect(originalPrompt.profileId).toBe(profile.id);
    expect(originalPrompt.systemPrompt).toBe("You are a helpful assistant.");
    expect(originalPrompt.version).toBe(1);

    // Step 3: Get all prompts and verify this prompt is returned
    const allPromptsResponse = await makeApiRequest({
      request,
      method: "get",
      urlSuffix: "/api/prompts",
    });
    const allPrompts = await allPromptsResponse.json();
    const foundPrompt = allPrompts.find(
      (p: { id: string }) => p.id === originalPrompt.id,
    );
    expect(foundPrompt).toBeDefined();
    expect(foundPrompt.profileId).toBe(profile.id);

    // Step 4: Update the prompt (with JSONB versioning, ID stays the same)
    const updatePromptResponse = await makeApiRequest({
      request,
      method: "patch",
      urlSuffix: `/api/prompts/${originalPrompt.id}`,
      data: {
        systemPrompt: "You are an updated helpful assistant.",
      },
    });
    const updatedPrompt = await updatePromptResponse.json();

    // Verify version was incremented (ID stays the same with JSONB history)
    expect(updatedPrompt.id).toBe(originalPrompt.id);
    expect(updatedPrompt.version).toBe(2);
    expect(updatedPrompt.systemPrompt).toBe(
      "You are an updated helpful assistant.",
    );
    expect(updatedPrompt.profileId).toBe(profile.id);

    // Step 5: Verify the prompt is returned when fetching all prompts
    const allPromptsAfterUpdateResponse = await makeApiRequest({
      request,
      method: "get",
      urlSuffix: "/api/prompts",
    });
    const allPromptsAfterUpdate = await allPromptsAfterUpdateResponse.json();
    const foundUpdatedPrompt = allPromptsAfterUpdate.find(
      (p: { id: string }) => p.id === updatedPrompt.id,
    );
    expect(foundUpdatedPrompt).toBeDefined();
    expect(foundUpdatedPrompt.version).toBe(2);
    expect(foundUpdatedPrompt.profileId).toBe(profile.id);

    // Cleanup
    await makeApiRequest({
      request,
      method: "delete",
      urlSuffix: `/api/prompts/${updatedPrompt.id}`,
    });
    await makeApiRequest({
      request,
      method: "delete",
      urlSuffix: `/api/profiles/${profile.id}`,
    });
  });

  test("should preserve multiple profile relationships when updating a prompt", async ({
    request,
    createProfile,
    makeApiRequest,
  }) => {
    // Step 1: Create multiple profiles
    const profile1Response = await createProfile(
      request,
      "Profile 1 for Multi Test",
    );
    const profile1 = await profile1Response.json();

    const profile2Response = await createProfile(
      request,
      "Profile 2 for Multi Test",
    );
    const profile2 = await profile2Response.json();

    const profile3Response = await createProfile(
      request,
      "Profile 3 for Multi Test",
    );
    const profile3 = await profile3Response.json();

    // Step 2: Create a prompt for profile1 with the same name that will be shared conceptually
    const createPromptResponse = await makeApiRequest({
      request,
      method: "post",
      urlSuffix: "/api/prompts",
      data: {
        name: "Shared System Prompt",
        profileId: profile1.id,
        systemPrompt: "Original shared prompt content.",
      },
    });
    const originalPrompt = await createPromptResponse.json();

    // Step 3: Create separate prompts with the same name for profile2 and profile3
    // (In the new structure, each profile needs its own prompt instance)
    const prompt2Response = await makeApiRequest({
      request,
      method: "post",
      urlSuffix: "/api/prompts",
      data: {
        name: "Shared System Prompt",
        profileId: profile2.id,
        systemPrompt: "Original shared prompt content.",
      },
    });
    const prompt2 = await prompt2Response.json();

    const prompt3Response = await makeApiRequest({
      request,
      method: "post",
      urlSuffix: "/api/prompts",
      data: {
        name: "Shared System Prompt",
        profileId: profile3.id,
        systemPrompt: "Original shared prompt content.",
      },
    });
    const prompt3 = await prompt3Response.json();

    // Step 4: Verify all prompts exist
    expect(originalPrompt.profileId).toBe(profile1.id);
    expect(prompt2.profileId).toBe(profile2.id);
    expect(prompt3.profileId).toBe(profile3.id);
    expect(originalPrompt.name).toBe("Shared System Prompt");
    expect(prompt2.name).toBe("Shared System Prompt");
    expect(prompt3.name).toBe("Shared System Prompt");

    // Step 5: Update the prompt for profile1 (this should create a new version)
    const updatePromptResponse = await makeApiRequest({
      request,
      method: "patch",
      urlSuffix: `/api/prompts/${originalPrompt.id}`,
      data: {
        systemPrompt: "Updated shared prompt content.",
      },
    });
    const updatedPrompt = await updatePromptResponse.json();

    // Step 6: Verify the new version belongs to profile1
    expect(updatedPrompt.profileId).toBe(profile1.id);
    expect(updatedPrompt.version).toBe(2);
    expect(updatedPrompt.systemPrompt).toBe("Updated shared prompt content.");

    // Step 7: Verify prompts for profile2 and profile3 are unchanged
    const prompt2AfterUpdateResponse = await makeApiRequest({
      request,
      method: "get",
      urlSuffix: `/api/prompts/${prompt2.id}`,
    });
    const prompt2AfterUpdate = await prompt2AfterUpdateResponse.json();
    expect(prompt2AfterUpdate.version).toBe(1);
    expect(prompt2AfterUpdate.systemPrompt).toBe(
      "Original shared prompt content.",
    );

    const prompt3AfterUpdateResponse = await makeApiRequest({
      request,
      method: "get",
      urlSuffix: `/api/prompts/${prompt3.id}`,
    });
    const prompt3AfterUpdate = await prompt3AfterUpdateResponse.json();
    expect(prompt3AfterUpdate.version).toBe(1);
    expect(prompt3AfterUpdate.systemPrompt).toBe(
      "Original shared prompt content.",
    );

    // Cleanup
    await makeApiRequest({
      request,
      method: "delete",
      urlSuffix: `/api/prompts/${updatedPrompt.id}`,
    });
    await makeApiRequest({
      request,
      method: "delete",
      urlSuffix: `/api/prompts/${prompt2.id}`,
    });
    await makeApiRequest({
      request,
      method: "delete",
      urlSuffix: `/api/prompts/${prompt3.id}`,
    });
    await makeApiRequest({
      request,
      method: "delete",
      urlSuffix: `/api/profiles/${profile1.id}`,
    });
    await makeApiRequest({
      request,
      method: "delete",
      urlSuffix: `/api/profiles/${profile2.id}`,
    });
    await makeApiRequest({
      request,
      method: "delete",
      urlSuffix: `/api/profiles/${profile3.id}`,
    });
  });

  test("should create and retrieve a prompt", async ({
    request,
    createProfile,
    makeApiRequest,
  }) => {
    // Create a profile first since prompts now require profileId
    const createProfileResponse = await createProfile(
      request,
      "Test Profile for Prompt",
    );
    const profile = await createProfileResponse.json();

    const createResponse = await makeApiRequest({
      request,
      method: "post",
      urlSuffix: "/api/prompts",
      data: {
        name: "Test Prompt",
        profileId: profile.id,
        systemPrompt: "Test system content",
        userPrompt: "Test user content",
      },
    });
    const prompt = await createResponse.json();

    expect(prompt).toHaveProperty("id");
    expect(prompt.name).toBe("Test Prompt");
    expect(prompt.profileId).toBe(profile.id);
    expect(prompt.systemPrompt).toBe("Test system content");
    expect(prompt.userPrompt).toBe("Test user content");
    expect(prompt.version).toBe(1);

    // Verify we can retrieve it
    const getResponse = await makeApiRequest({
      request,
      method: "get",
      urlSuffix: `/api/prompts/${prompt.id}`,
    });
    const retrievedPrompt = await getResponse.json();
    expect(retrievedPrompt.id).toBe(prompt.id);
    expect(retrievedPrompt.name).toBe("Test Prompt");
    expect(retrievedPrompt.systemPrompt).toBe("Test system content");

    // Cleanup
    await makeApiRequest({
      request,
      method: "delete",
      urlSuffix: `/api/prompts/${prompt.id}`,
    });
    await makeApiRequest({
      request,
      method: "delete",
      urlSuffix: `/api/profiles/${profile.id}`,
    });
  });
});
