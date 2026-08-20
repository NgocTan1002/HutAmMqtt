import type { DeviceRepository, MqttConnectionRepository } from './repositories.js';

export const emptyMqttConnectionRepository: MqttConnectionRepository = {
  async getEnabled() {
    return [];
  },
  async getById() {
    return null;
  },
};

export const emptyDeviceRepository: DeviceRepository = {
  async getEnabled() {
    return [];
  },
  async getById() {
    return null;
  },
};
