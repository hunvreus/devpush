import { z } from 'zod'

const metricValuesSchema = z.object({
  cpuPercent: z.number().min(0).max(100).optional(),
  memoryUsedBytes: z.number().int().min(0).optional(),
  memoryTotalBytes: z.number().int().min(0).optional(),
  diskUsedBytes: z.number().int().min(0).optional(),
  diskTotalBytes: z.number().int().min(0).optional(),
  networkReceiveBytesPerSecond: z.number().min(0).optional(),
  networkTransmitBytesPerSecond: z.number().min(0).optional(),
  diskReadBytesPerSecond: z.number().min(0).optional(),
  diskWriteBytesPerSecond: z.number().min(0).optional(),
})

export const metricSampleSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{32}$/),
  observedAt: z.string().datetime(),
  metrics: metricValuesSchema.refine(
    (values) => Object.values(values).some(Number.isFinite),
    'Metric sample must contain a measurement.',
  ),
})

export type AgentMetricSample = z.infer<typeof metricSampleSchema>
