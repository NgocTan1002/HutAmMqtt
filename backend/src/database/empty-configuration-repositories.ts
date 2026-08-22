import type { DeviceRepository, MqttConnectionRepository } from './repositories.js';

export const emptyMqttConnectionRepository: MqttConnectionRepository = {
  async getAll() { return []; },
  async getEnabled() {
    return [];
  },
  async getById() {
    return null;
  },
  async create() { throw new Error('MQTT configuration requires PostgreSQL.'); },
  async update() { throw new Error('MQTT configuration requires PostgreSQL.'); },
  async delete() { return false; },
  async countDevices() { return 0; },
};

export const emptyDeviceRepository: DeviceRepository = {
  async getAll() { return []; },
  async getEnabled() {
    return [];
  },
  async getById() {
    return null;
  },
  async create() { throw new Error('Device configuration requires PostgreSQL.'); },
  async update() { throw new Error('Device configuration requires PostgreSQL.'); },
  async delete() { return false; },
  async getDataUsage() { return { telemetry: 0, commands: 0, events: 0, total: 0 }; },
};
