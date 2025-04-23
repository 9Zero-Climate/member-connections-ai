# Member Connections AI (Friendly name: "Fabric")

[![Tests](https://github.com/9Zero-Climate/member-connections-ai/actions/workflows/test.yml/badge.svg)](https://github.com/9Zero-Climate/member-connections-ai/actions/workflows/test.yml)
[![Sync](https://github.com/9Zero-Climate/member-connections-ai/actions/workflows/sync-all.yml/badge.svg)](https://github.com/9Zero-Climate/member-connections-ai/actions/workflows/sync-all.yml)

AI-powered member connections for Slack, helping community members find and connect with each other.

## Development

### Prerequisites

- Node.js
- Docker (for local Postgres db with PGVector extension)
- pnpm
- .env file with correct environment variables

### Setup

1. Clone the repository
2. Install dependencies:

```bash
pnpm install
```

3. Create a `.env` file with. See `config.ts` for required environment variables

### Running the Bot Server

To run the Slack bot server:

```bash
# Production mode
pnpm start

# Development mode with hot reloading
pnpm dev
```

The bot server provides:
- Interactive member connections through Slack
- Health check endpoint at http://localhost:8080
- Socket Mode for secure communication with Slack

### Manual Sync

To manually sync messages from a Slack channel:

```bash
# Sync recent messages from a channel
pnpm sync introductions
```

### Local database
To set up a local version of the supabase database:

Start local supabase:

```bash
pnpm supabase start
```

Run migrations:

```bash
npx tsx src/scripts/setup_test_db.ts
```

Optionally, run the various sync scripts to sync production data (skip LinkedIn - that's expensive)

```bash
pnpm sync:officernd
pnpm sync:notion
pnpm sync:slack introductions
```

View the dashboard at `http://localhost:54323/`


## Logging

Logs from this project are handled by pino and sent to BetterStack Telemetry (fka Logtail).
See em at https://telemetry.betterstack.com/team/315967/

Whenever possible, when using the logger, log the relevant user slack ID as "user" in the log object. This facilitates filtering logs in BetterStack.


## GitHub Actions

The project includes automated workflows:

- **Tests**: Runs on push and pull requests to main branch
  - Runs linting checks
  - Runs all tests
  - Uploads coverage reports to Codecov
  - Requires `DB_URL` secret

- **Sync All**: Runs daily at midnight Pacific time to sync data from external sources (OfficeRnD, Notion, LinkedIn, Slack)
  - Can be manually triggered from the Actions tab
  - Requires various environment variables, see `config.ts`