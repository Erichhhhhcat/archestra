import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { schema } from "@/database";
import { UuidIdSchema } from "./api";

export const SelectLabelKeySchema = createSelectSchema(schema.labelKeysTable);
export const InsertLabelKeySchema = createInsertSchema(schema.labelKeysTable);

export const SelectLabelValueSchema = createSelectSchema(
  schema.labelValuesTable,
);
export const InsertLabelValueSchema = createInsertSchema(
  schema.labelValuesTable,
);

export const SelectProfileLabelSchema = createSelectSchema(
  schema.profileLabelsTable,
);
export const InsertProfileLabelSchema = createInsertSchema(
  schema.profileLabelsTable,
);

// Combined label schema for easier frontend consumption
export const ProfileLabelWithDetailsSchema = z.object({
  key: z.string(),
  value: z.string(),
  keyId: UuidIdSchema.optional(),
  valueId: UuidIdSchema.optional(),
});

export type LabelKey = z.infer<typeof SelectLabelKeySchema>;
export type InsertLabelKey = z.infer<typeof InsertLabelKeySchema>;

export type LabelValue = z.infer<typeof SelectLabelValueSchema>;
export type InsertLabelValue = z.infer<typeof InsertLabelValueSchema>;

export type ProfileLabel = z.infer<typeof SelectProfileLabelSchema>;
export type InsertProfileLabel = z.infer<typeof InsertProfileLabelSchema>;

export type ProfileLabelWithDetails = z.infer<
  typeof ProfileLabelWithDetailsSchema
>;
