import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { DualLlmMessage } from "@/types";
import profilesTable from "./profile";

/**
 * Stores results from the Dual LLM Quarantine Pattern
 * Records the Q&A conversation and safe summary for each tool call
 */
const dualLlmResultsTable = pgTable(
  "dual_llm_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    toolCallId: text("tool_call_id").notNull(),
    conversations: jsonb("conversations").$type<DualLlmMessage[]>().notNull(),
    result: text("result").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    profileIdIdx: index("dual_llm_results_profile_id_idx").on(table.profileId),
  }),
);

export default dualLlmResultsTable;
