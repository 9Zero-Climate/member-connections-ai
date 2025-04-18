# Member Connections AI (Friendly name: "Fabric")

[![Tests](https://github.com/9Zero-Climate/member-connections-ai/actions/workflows/test.yml/badge.svg)](https://github.com/9Zero-Climate/member-connections-ai/actions/workflows/test.yml)
[![Sync](https://github.com/9Zero-Climate/member-connections-ai/actions/workflows/sync-all.yml/badge.svg)](https://github.com/9Zero-Climate/member-connections-ai/actions/workflows/sync-all.yml)

AI-powered member connections for Slack, helping community members find and connect with each other.

## Development

### Prerequisites

- Node.js
- pnpm
- Slack Bot Token
- Slack App Token (for Socket Mode)
- PostgreSQL Database URL with PGVector extension
- OpenRouter API Key

### Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   pnpm install
   ```
3. Create a `.env` file with:
   ```
   SLACK_BOT_TOKEN=your_slack_bot_token
   SLACK_APP_TOKEN=your_slack_app_token
   DB_URL=your_database_url
   OPENROUTER_API_KEY=your_openrouter_api_key
   APP_URL=https://github.com/9Zero-Climate/member-connections-ai
   PORT=8080  # Optional, defaults to 8080
   ```

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

### Manual Slack Sync

To manually sync messages from a Slack channel:

```bash
# Sync recent messages from a channel
pnpm sync introductions
```

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

- **Slack Sync**: Runs daily at midnight Pacific time to sync messages from configured Slack channels
  - Can be manually triggered from the Actions tab
  - Supports custom channel selection for manual runs
  - Requires `SLACK_BOT_TOKEN` and `DB_URL` secrets

