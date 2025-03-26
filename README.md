# Member Connections AI

[![Tests](https://github.com/9Zero-Climate/member-connections-ai/actions/workflows/test.yml/badge.svg)](https://github.com/9Zero-Climate/member-connections-ai/actions/workflows/test.yml)
[![Slack Sync](https://github.com/9Zero-Climate/member-connections-ai/actions/workflows/slack-sync.yml/badge.svg)](https://github.com/9Zero-Climate/member-connections-ai/actions/workflows/slack-sync.yml)

AI-powered member connections for Slack, helping community members find and connect with each other.

## Features

- Slack message syncing and storage
- AI-powered member connections
- Automated daily syncs
- Manual sync capabilities

## Development

### Prerequisites

- Node.js 18+
- pnpm 8.15.4+
- Slack Bot Token
- PostgreSQL Database URL with PGVector extension

### Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   pnpm install
   ```
3. Create a `.env` file with:
   ```
   SLACK_BOT_TOKEN=your_slack_bot_token
   DATABASE_URL=your_database_url
   ```

### Running Tests

```bash
pnpm test
```

### End to end testing

To run the app locally:

1. make sure you .env file is set up with values for a Slack app installation in a test workspace
2. run the app locally with:

```bash
pnpm start
```

### Manual Slack Sync

To manually sync messages from a Slack channel:

```bash
# Sync last 100 messages from a channel
pnpm sync sync-channel introductions

# Sync with custom limit
pnpm sync sync-channel introductions --limit 50

# Sync messages from a specific time range
pnpm sync sync-channel introductions --oldest 1704067200 --newest 1704153600
```

## GitHub Actions

The project includes automated workflows:

- **Tests**: Runs on push and pull requests to main branch
  - Runs linting checks
  - Runs all tests
  - Uploads coverage reports to Codecov
  - Requires `DATABASE_URL` secret

- **Slack Sync**: Runs daily at midnight Pacific time to sync messages from configured Slack channels
  - Can be manually triggered from the Actions tab
  - Supports custom channel selection for manual runs
  - Requires `SLACK_BOT_TOKEN` and `DATABASE_URL` secrets

