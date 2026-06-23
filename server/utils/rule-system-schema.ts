/**
 * Zod-Schema fuer die RuleSystemDefinition (Custom-Regelwerke).
 * Wird von den rule-systems-POST/PUT-Endpoints verwendet.
 */
import { z } from 'zod'
import { RS_DICE_MECHANICS } from '~~/shared/rule-system'

const keySchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]{0,19}$/, 'Key: Buchstabe zuerst, dann Buchstaben/Zahlen/_ (max 20).')

const attributeSchema = z.object({
  key: keySchema,
  label: z.string().min(1).max(40),
  default: z.number().int().min(-1000).max(1000),
  min: z.number().int().min(-1000).max(1000),
  max: z.number().int().min(-1000).max(1000),
})

const skillSchema = z.object({
  key: keySchema,
  label: z.string().min(1).max(40),
  attribute: z.string().max(20).optional(),
  default: z.number().int().min(-1000).max(1000),
})

const diceSchema = z.object({
  mechanic: z.enum(RS_DICE_MECHANICS),
  dieSize: z.number().int().min(2).max(1000),
})

const hpSchema = z.object({
  maxFormula: z.string().max(200),
})

export const ruleSystemDefinitionSchema = z.object({
  attributes: z.array(attributeSchema).min(1).max(30),
  skills: z.array(skillSchema).max(100),
  hp: hpSchema,
  dice: diceSchema,
  modules: z.record(z.unknown()).optional(),
})

export type RuleSystemDefinitionInput = z.infer<typeof ruleSystemDefinitionSchema>
