-- Agent self-registration: store bcrypt password hash chosen at apply time
ALTER TABLE agent_registration_requests
  ADD COLUMN IF NOT EXISTS password_hash text DEFAULT NULL;
