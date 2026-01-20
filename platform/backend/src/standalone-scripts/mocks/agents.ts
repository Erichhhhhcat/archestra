import { randomUUID } from "node:crypto";
import type { InsertProfile } from "@/types";
import { randomBool, randomElement } from "./utils";

const PROFILE_NAME_TEMPLATES = [
  "Data Analyst",
  "API Monitor",
  "Security Scanner",
  "Performance Optimizer",
  "Code Reviewer",
  "Content Moderator",
  "Quality Assurance",
  "System Administrator",
  "Database Manager",
  "Network Engineer",
  "Cloud Architect",
  "DevOps Specialist",
  "Frontend Developer",
  "Backend Developer",
  "Full Stack Engineer",
  "Machine Learning Engineer",
  "Data Scientist",
  "Automation Specialist",
  "Integration Expert",
  "Support Agent",
];

const PROFILE_SUFFIXES = [
  "",
  " Pro",
  " Advanced",
  " Enterprise",
  " Plus",
  " AI",
  " Assistant",
  " Bot",
  " v2",
  " Next",
];

/**
 * Generate a unique profile name by combining templates and suffixes
 */
function generateProfileName(index: number): string {
  const template = randomElement(PROFILE_NAME_TEMPLATES);
  const suffix =
    index < PROFILE_NAME_TEMPLATES.length * 3
      ? randomElement(PROFILE_SUFFIXES)
      : ` #${Math.floor(index / 10) + 1}`;
  return `${template}${suffix}`;
}

type MockProfile = InsertProfile & { id: string };

/**
 * Generate mock profile data
 * @param count - Number of profiles to generate (defaults to 90)
 */
export function generateMockProfiles(count = 90): MockProfile[] {
  const profiles: MockProfile[] = [];

  for (let i = 0; i < count; i++) {
    profiles.push({
      id: randomUUID(),
      name: generateProfileName(i),
      isDemo: randomBool(0.3), // 30% chance of being a demo profile
      teams: [],
    });
  }

  return profiles;
}
