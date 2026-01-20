import logger from "@/logging";
import { OrganizationModel, ProfileTeamModel, TeamModel } from "@/models";

// Stats we expect to get from the compression from each LLM provider
// TODO: ideally compression itself should live somewhere here too, but it's far away for now.
export interface CompressionStats {
  toonTokensBefore: number | null;
  toonTokensAfter: number | null;
  toonCostSavings: number | null;
}

/**
 * Determine if TOON compression should be applied based on organization/team settings
 * Follows the same pattern as cost optimization: uses profile's teams or fallback to first org
 */
export async function shouldApplyToonCompression(
  profileId: string,
): Promise<boolean> {
  // Get organizationId the same way cost optimization does: from profile's teams OR fallback
  let organizationId: string | null = null;
  const profileTeamIds = await ProfileTeamModel.getTeamsForProfile(profileId);

  if (profileTeamIds.length > 0) {
    // Get organizationId from profile's first team
    const teams = await TeamModel.findByIds(profileTeamIds);
    if (teams.length > 0 && teams[0].organizationId) {
      organizationId = teams[0].organizationId;
      logger.info(
        { profileId, organizationId },
        "TOON compression: resolved organizationId from team",
      );
    }
  } else {
    // If profile has no teams, use fallback to first organization in database
    const firstOrg = await OrganizationModel.getFirst();

    if (firstOrg) {
      organizationId = firstOrg.id;
      logger.info(
        { profileId, organizationId },
        "TOON compression: profile has no teams - using fallback organization",
      );
    }
  }

  if (!organizationId) {
    logger.warn(
      { profileId },
      "TOON compression: could not resolve organizationId",
    );
    return false;
  }

  // Fetch the organization to get compression settings
  const organization = await OrganizationModel.getById(organizationId);
  if (!organization) {
    logger.warn(
      { profileId, organizationId },
      "TOON compression: organization not found",
    );
    return false;
  }

  // Check compression scope and determine if TOON should be applied
  if (organization.compressionScope === "organization") {
    logger.info(
      { profileId, enabled: organization.convertToolResultsToToon },
      "TOON compression: organization-level scope",
    );
    return organization.convertToolResultsToToon;
  }

  if (organization.compressionScope === "team") {
    // Team-level: check if ANY of the profile's teams have compression enabled
    const profileTeams = await TeamModel.getTeamsForProfile(profileId);
    const shouldApply = profileTeams.some(
      (team: { convertToolResultsToToon: boolean }) =>
        team.convertToolResultsToToon,
    );
    logger.info(
      { profileId, teamsCount: profileTeams.length, enabled: shouldApply },
      "TOON compression: team-level scope",
    );
    return shouldApply;
  }

  // Default: compression disabled
  logger.info(
    { profileId },
    "TOON compression: disabled (no scope configured)",
  );
  return false;
}
