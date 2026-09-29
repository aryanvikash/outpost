-- Latest heartbeat telemetry (HostStats JSON), shown on the dashboard and
-- checked for the machine_resource alert.
ALTER TABLE machines ADD COLUMN stats_json TEXT;
