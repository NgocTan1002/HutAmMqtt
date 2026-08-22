import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { z } from 'zod';

export const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
loadDotenv({ path: resolve(projectRoot, '.env') });

const environmentSchema = z.object({
  BACKEND_PORT: z.coerce.number().int().positive().default(3001),
  CONFIG_REFRESH_INTERVAL_MS: z.coerce.number().int().min(1_000).default(5_000),
  CONFIG_ENCRYPTION_KEY: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().refine(
      (value) => {
        const decoded = Buffer.from(value, 'base64');
        return decoded.length === 32 && decoded.toString('base64') === value;
      },
      'CONFIG_ENCRYPTION_KEY must be a base64-encoded 32-byte key.',
    ).optional(),
  ),
  DATABASE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  DATABASE_DRIVER: z.enum(['sqlite', 'postgres']).default('sqlite'),
  DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  DATABASE_PATH: z.string().trim().min(1).default('data/nhiet-am-mqtt.db'),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().max(100).default(10),
  DATABASE_SSL: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  DATABASE_URL: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().url().optional(),
  ),
  DEVICE_ID: z.string().trim().min(1).default('mayhutam1'),
  DEVICE_OFFLINE_AFTER_SECONDS: z.coerce.number().int().positive().default(20),
  FRONTEND_PORT: z.coerce.number().int().positive().default(5173),
  MQTT_BROKER_URL: z.string().trim().url().default('mqtt://localhost:1883'),
  MQTT_COMMAND_TOPIC: z.string().trim().min(1).default('mayhutam1/caidat'),
  MQTT_PASSWORD: z.string().optional(),
  MQTT_RESPONSE_TOPIC: z.string().trim().min(1).default('mayhutam1/nhan'),
  MQTT_TELEMETRY_TOPIC: z.string().trim().min(1).default('mayhutam1/nhan'),
  MQTT_USERNAME: z.string().optional(),
  MQTT_USE_TLS: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
}).superRefine((value, context) => {
  if (value.DATABASE_DRIVER === 'postgres' && !value.DATABASE_URL) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DATABASE_URL'],
      message: 'DATABASE_URL is required when DATABASE_DRIVER=postgres.',
    });
  }
});

const parsedEnvironment = environmentSchema.safeParse(process.env);

if (!parsedEnvironment.success) {
  console.error('Invalid environment configuration:', parsedEnvironment.error.flatten().fieldErrors);
  throw new Error('Cannot start backend because .env is invalid.');
}

export const env = parsedEnvironment.data;
