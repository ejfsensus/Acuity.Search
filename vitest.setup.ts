import '@testing-library/jest-dom'

// Provide dummy values for environment variables required during tests
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://user:pass@localhost:5432/testdb'

// Open-edition BYOK defaults to "required" in production. Legacy suites exercise
// the deployment-key paths, so they run with it off; BYOK suites opt in.
process.env.ACUITY_BYOK_MODE = process.env.ACUITY_BYOK_MODE ?? 'off'
