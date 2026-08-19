import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { z } from 'zod';

export const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
loadDotenv({ path: resolve(projectRoot, '.env') });

const environmentSchema = z.object({
  BACKEND_PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_PATH: z.string().trim().min(1).default('data/nhiet-am-mqtt.db'),
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
});

const parsedEnvironment = environmentSchema.safeParse(process.env);

if (!parsedEnvironment.success) {
  console.error('Invalid environment configuration:', parsedEnvironment.error.flatten().fieldErrors);
  throw new Error('Cannot start backend because .env is invalid.');
}

export const env = parsedEnvironment.data;
