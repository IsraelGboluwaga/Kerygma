import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
  ADMIN_SECRET: z.string().min(1, 'ADMIN_SECRET is required'),
  MINISTRY_NAME: z.string().min(1).default('the church'),
  DB_PATH: z.string().default('./data/sermons.db'),
  PORT: z.coerce.number().int().positive().default(3000),
  MAX_AUDIO_DURATION_SECONDS: z.coerce.number().int().positive().default(7200),
  WHISPER_MODEL: z.string().default('medium.en'),
  CLAUDE_MODEL: z.string().default('claude-sonnet-4-20250514'),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  const errors = parsed.error.issues
    .map((i) => `  ${i.path.join('.')}: ${i.message}`)
    .join('\n')
  console.error(`[config] Invalid environment variables:\n${errors}`)
  process.exit(1)
}

export const config = Object.freeze(parsed.data)
