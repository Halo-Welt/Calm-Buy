const { z } = require('zod')

const NEED_IDS = ['identity', 'novelty', 'utility', 'anxiety', 'emotion', 'belong', 'collect']
const PHASES = ['clarify_need', 'confirm_need', 'done']
const DECISION_TIERS = ['trivial', 'standard', 'major']

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(2000)
})

const draftSchema = z.object({
  productName: z.string().max(200).default(''),
  decisionTier: z.enum(DECISION_TIERS).nullable().default(null),
  tierReason: z.string().max(200).default(''),
  desiredOutcome: z.string().max(500).default(''),
  scene: z.string().max(500).default(''),
  frequency: z.string().max(200).default(''),
  currentAlternative: z.string().max(500).default(''),
  gap: z.string().max(500).default(''),
  counterfactual: z.string().max(500).default(''),
  constraints: z.array(z.string().max(200)).max(5).default([]),
  failureConditions: z.array(z.string().max(200)).max(5).default([]),
  successCriterion: z.string().max(500).default(''),
  functionalNeed: z.string().max(500).default(''),
  emotionalNeed: z.string().max(500).default(''),
  socialNeed: z.string().max(500).default(''),
  rootNeed: z.string().max(500).default(''),
  primaryNeedId: z.enum(NEED_IDS).nullable().default(null),
  secondaryNeedId: z.enum(NEED_IDS).nullable().default(null),
  evidenceQuotes: z.array(z.string().max(500)).max(6).default([]),
  missingDimensions: z.array(z.string().max(100)).max(6).default([]),
  readiness: z.number().min(0).max(1).default(0),
  userConfirmedNeed: z.boolean().default(false)
})

const alternativeSchema = z.object({
  title: z.string().trim().min(1).max(100),
  why: z.string().trim().min(1).max(300),
  servesNeedId: z.enum(NEED_IDS),
  type: z.enum(['non_purchase', 'rent_or_try', 'product'])
})

const candidateProductSchema = z.object({
  title: z.string().trim().min(1).max(100),
  why: z.string().trim().min(1).max(300),
  servesNeedId: z.enum(NEED_IDS),
  verificationStatus: z.string().max(100).default('模型常识，未联网核验'),
  price: z.union([z.string().trim().min(1).max(40), z.null()]).optional(),
  url: z.union([z.string().trim().max(500), z.null()]).optional()
})

const marketSnapshotSchema = z.object({
  priceRange: z.union([z.string().trim().min(1).max(120), z.null()]).default(null),
  reputation: z.string().max(600).default(''),
  watchOuts: z.array(z.string().trim().min(1).max(200)).max(3).default([])
})

const resultSchema = z.object({
  verdict: z.enum(['stop', 'wait', 'buy', 'replace']),
  confidence: z.enum(['high', 'medium', 'low']),
  needSentence: z.string().trim().min(1).max(500),
  primaryNeedId: z.enum(NEED_IDS),
  matchScore: z.enum(['high', 'medium', 'low']),
  rootNeed: z.string().trim().min(1).max(500),
  needDecomposition: z.object({
    functional: z.string().max(500).default(''),
    emotional: z.string().max(500).default(''),
    social: z.string().max(500).default(''),
    constraints: z.array(z.string().max(200)).max(5).default([]),
    successCriterion: z.string().max(500).default('')
  }),
  evidenceQuotes: z.array(z.string().max(500)).min(1).max(6),
  reasons: z.array(z.string().trim().min(1).max(300)).min(1).max(3),
  marketSnapshot: marketSnapshotSchema.default({}),
  minimumExperiment: z.object({
    title: z.string().trim().min(1).max(100),
    action: z.string().trim().min(1).max(500),
    duration: z.string().max(100).default('')
  }).nullable().default(null),
  alternatives: z.array(alternativeSchema).max(4).default([]),
  candidateProducts: z.array(candidateProductSchema).max(3).default([]),
  nextStep: z.string().trim().min(1).max(500),
  cooldownHours: z.number().int().min(0).max(168).default(48)
})

/** 客户端在本机算出的行为信号：只描述用户此刻的状态，不描述商品 */
const impulseSchema = z.object({
  temperature: z.number().min(0).max(100).default(0),
  signals: z.array(z.string().trim().min(1).max(80)).max(6).default([])
})

const analyzeRequestSchema = z.object({
  requestId: z.string().min(8).max(100),
  sessionId: z.string().min(8).max(100),
  productText: z.string().trim().min(1).max(500),
  messages: z.array(messageSchema).max(18).default([]),
  phase: z.enum(['clarify_need', 'confirm_need']).default('clarify_need'),
  questionCount: z.number().int().min(0).max(6).default(0),
  confirmation: z.boolean().nullable().optional(),
  draft: draftSchema.partial().optional(),
  impulse: impulseSchema.optional()
})

const analyzeResponseSchema = z.object({
  assistantMessage: z.string().trim().min(1).max(1000),
  phase: z.enum(PHASES),
  inputType: z.enum(['text', 'choice', 'none']),
  options: z.array(z.string().trim().min(1).max(100)).max(5).default([]),
  progress: z.object({
    current: z.number().int().min(0).max(6),
    total: z.number().int().min(1).max(6),
    label: z.string().max(100)
  }),
  draft: draftSchema,
  result: resultSchema.nullable().default(null)
})

module.exports = {
  NEED_IDS,
  analyzeRequestSchema,
  analyzeResponseSchema,
  draftSchema,
  resultSchema
}
