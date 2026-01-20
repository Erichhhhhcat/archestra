import { pathToFileURL } from "node:url";
import { ADMIN_ROLE_NAME, MEMBER_ROLE_NAME } from "@shared";
import db, { schema } from "@/database";
import { seedDefaultUserAndOrg } from "@/database/seed";
import logger from "@/logging";
import { OrganizationModel, ProfileModel, TeamModel } from "@/models";
import {
  generateMockInteractions,
  generateMockProfiles,
  generateMockTools,
} from "./mocks";

// Set to true to create tools and interactions
// Don't delete this const for development convenience
const CREATE_TOOLS_AND_INTERACTIONS = false;

async function seedMockData() {
  logger.info("\n🌱 Starting mock data seed...\n");

  // Step 0: Clean existing mock data (in correct order due to foreign keys)
  logger.info("Cleaning existing data...");
  for (const table of Object.values(schema)) {
    await db.delete(table);
  }
  logger.info("✅ Cleaned existing data");

  // Step 1: Create additional users
  const defaultAdmin = await seedDefaultUserAndOrg();
  const admin2User = await seedDefaultUserAndOrg({
    email: "admin-2@example.com",
    password: "password",
    role: ADMIN_ROLE_NAME,
    name: "Admin-2",
  });
  const member1User = await seedDefaultUserAndOrg({
    email: "member-1@example.com",
    password: "password",
    role: MEMBER_ROLE_NAME,
    name: "Member-1",
  });
  const member2User = await seedDefaultUserAndOrg({
    email: "member-2@example.com",
    password: "password",
    role: MEMBER_ROLE_NAME,
    name: "Member-2",
  });

  // Step 2: Create teams and add members
  const org = await OrganizationModel.getOrCreateDefaultOrganization();
  const managementTeam = await TeamModel.create({
    name: "Management Team",
    description:
      "Management department responsible for overseeing the platform",
    organizationId: org.id,
    createdBy: admin2User.id,
  });
  const marketingTeam = await TeamModel.create({
    name: "Marketing Team",
    description: "Marketing department responsible for promoting the platform",
    organizationId: org.id,
    createdBy: admin2User.id,
  });
  await TeamModel.addMember(
    managementTeam.id,
    defaultAdmin.id,
    ADMIN_ROLE_NAME,
  );
  await TeamModel.addMember(managementTeam.id, admin2User.id, ADMIN_ROLE_NAME);
  await TeamModel.addMember(marketingTeam.id, defaultAdmin.id, ADMIN_ROLE_NAME);
  await TeamModel.addMember(marketingTeam.id, member1User.id, MEMBER_ROLE_NAME);
  await TeamModel.addMember(marketingTeam.id, member2User.id, MEMBER_ROLE_NAME);

  // Step 2: Create profiles
  logger.info("\nCreating profiles...");
  await ProfileModel.getProfileOrCreateDefault(); // always recreate default profile
  const profileData = generateMockProfiles();

  await db.insert(schema.profilesTable).values(profileData);
  logger.info(`✅ Created ${profileData.length} profiles`);

  // Note: Archestra tools are no longer auto-assigned to profiles.
  // They are now managed like any other MCP server tools and must be explicitly assigned.

  if (CREATE_TOOLS_AND_INTERACTIONS === false) return;

  // Step 3: Create tools linked to profiles
  logger.info("\nCreating tools...");
  const profileIds = profileData
    .map((profile) => profile.id)
    .filter((id): id is string => !!id);
  const toolData = generateMockTools(profileIds);

  await db.insert(schema.toolsTable).values(toolData);
  logger.info(`✅ Created ${toolData.length} tools`);

  // Step 4: Create profile-tool relationships
  logger.info("\nCreating profile-tool relationships...");
  const profileToolData = toolData.map((tool) => ({
    profileId: tool.profileId,
    toolId: tool.id,
    allowUsageWhenUntrustedDataIsPresent:
      tool.allowUsageWhenUntrustedDataIsPresent || false,
    toolResultTreatment: (tool.dataIsTrustedByDefault
      ? "trusted"
      : "untrusted") as "trusted" | "untrusted" | "sanitize_with_dual_llm",
  }));

  await db.insert(schema.profileToolsTable).values(profileToolData);
  logger.info(
    `✅ Created ${profileToolData.length} profile-tool relationships`,
  );

  // Step 5: Create 200 mock interactions
  logger.info("\nCreating interactions...");

  // Group tools by profile for efficient lookup
  const toolsByProfile = new Map<string, typeof toolData>();
  for (const tool of toolData) {
    const existing = toolsByProfile.get(tool.profileId) || [];
    toolsByProfile.set(tool.profileId, [...existing, tool]);
  }

  const interactionData = generateMockInteractions(
    profileIds,
    toolsByProfile,
    200, // number of interactions
    0.3, // 30% block probability
  );

  // biome-ignore lint/suspicious/noExplicitAny: Mock data generation requires flexible interaction structure
  await db.insert(schema.interactionsTable).values(interactionData as any);
  logger.info(`✅ Created ${interactionData.length} interactions`);

  // Show statistics
  const blockedCount = interactionData.filter((i) => {
    if ("choices" in i.response) {
      const message = i.response.choices[0]?.message;
      return message && "refusal" in message && message.refusal;
    }
    return false;
  }).length;
  logger.info(`   - ${blockedCount} blocked by policy`);
  logger.info(`   - ${interactionData.length - blockedCount} allowed`);
}

/**
 * CLI entry point for seeding the database
 */
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedMockData()
    .then(() => {
      logger.info("\n✅ Mock data seeded successfully!\n");
      process.exit(0);
    })
    .catch((error) => {
      logger.error({ err: error }, "\n❌ Error seeding database:");
      process.exit(1);
    });
}
