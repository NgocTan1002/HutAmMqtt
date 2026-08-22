import { z } from 'zod';

const nullableText = (maximum: number) => z.string().trim().max(maximum).nullable();
const topic = z.string()
  .trim()
  .min(1, 'Topic không được để trống.')
  .max(1024)
  .refine((value) => !value.includes('#') && !value.includes('+'), 'Topic thiết bị không được chứa wildcard # hoặc +.');

export const mqttConnectionCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  brokerUrl: z.string().trim().min(1).max(2048),
  port: z.number().int().min(1).max(65_535),
  useTls: z.boolean(),
  username: nullableText(512).optional().default(null),
  password: nullableText(1024).optional().default(null),
  clientIdPrefix: nullableText(100).optional().default(null),
  enabled: z.boolean().optional().default(true),
}).strict();

export const mqttConnectionUpdateSchema = mqttConnectionCreateSchema.partial()
  .refine((value) => Object.keys(value).length > 0, 'Cần ít nhất một trường để cập nhật.');

export const mqttConnectionTestSchema = mqttConnectionCreateSchema.omit({ enabled: true });

export const deviceCreateSchema = z.object({
  id: z.string().trim().min(1).max(100).regex(
    /^[A-Za-z0-9_-]+$/,
    'ID thiết bị chỉ được chứa chữ, số, dấu gạch ngang và gạch dưới.',
  ),
  name: z.string().trim().min(1).max(150),
  mqttConnectionId: z.string().uuid(),
  telemetryTopic: topic,
  commandTopic: topic,
  responseTopic: topic,
  offlineAfterSeconds: z.number().int().positive().max(86_400),
  enabled: z.boolean().optional().default(true),
}).strict();

export const deviceUpdateSchema = deviceCreateSchema.omit({ id: true }).partial()
  .refine((value) => Object.keys(value).length > 0, 'Cần ít nhất một trường để cập nhật.');

export type MqttConnectionCreateInput = z.infer<typeof mqttConnectionCreateSchema>;
export type MqttConnectionUpdateInput = z.infer<typeof mqttConnectionUpdateSchema>;
export type MqttConnectionTestInput = z.infer<typeof mqttConnectionTestSchema>;
export type DeviceCreateInput = z.infer<typeof deviceCreateSchema>;
export type DeviceUpdateInput = z.infer<typeof deviceUpdateSchema>;
