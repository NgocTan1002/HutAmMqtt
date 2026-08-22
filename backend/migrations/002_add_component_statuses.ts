import type { MigrationBuilder } from 'node-pg-migrate';

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE telemetry
      ADD COLUMN filter_status SMALLINT,
      ADD COLUMN fan_status SMALLINT,
      ADD COLUMN heater_status SMALLINT,
      ADD CONSTRAINT telemetry_filter_status_check CHECK (filter_status IN (0, 1)),
      ADD CONSTRAINT telemetry_fan_status_check CHECK (fan_status IN (0, 1)),
      ADD CONSTRAINT telemetry_heater_status_check CHECK (heater_status IN (0, 1));
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE telemetry
      DROP CONSTRAINT IF EXISTS telemetry_filter_status_check,
      DROP CONSTRAINT IF EXISTS telemetry_fan_status_check,
      DROP CONSTRAINT IF EXISTS telemetry_heater_status_check,
      DROP COLUMN IF EXISTS filter_status,
      DROP COLUMN IF EXISTS fan_status,
      DROP COLUMN IF EXISTS heater_status;
  `);
}
