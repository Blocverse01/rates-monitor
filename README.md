# Rate Monitoring Tool

Real-time monitoring of USDC/USDT <> NGN rates from ByBit P2P and CNGN (Blockradar).

## Features

- 📊 Real-time rate streaming from ByBit P2P and CNGN
- 📈 Spread calculation between sources
- ⚠️ Volatility detection
- 📱 WhatsApp notifications via WhatsApp Business API
- 📧 Email alerts via SMTP
- 🏗️ Built with Effect.ts for type-safe dependency injection
- 🔄 BullMQ for reliable job scheduling

## Prerequisites

- Node.js >= 20.0.0
- Redis (for caching and job queue)
- ByBit API credentials
- Blockradar API key
- WhatsApp Business API access
- SMTP server credentials

## Quick Start

1. **Clone and Install**
   ```bash
   git clone <repository-url>
   cd rate-monitor
   pnpm install
   ```

2. **Configure Environment**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

3. **Start Redis**
   ```bash
   # Using Docker
   docker run -d -p 6379:6379 redis:latest
   
   # Or install locally
   brew install redis  # macOS
   sudo apt-get install redis-server  # Ubuntu
   ```

4. **Run Development Server**
   ```bash
   pnpm run dev
   ```

## Configuration

### WhatsApp Business API Setup

1. Create a Meta Business Account
2. Set up WhatsApp Business Platform
3. Get Access Token and Phone Number ID
4. Add test numbers during development

### SMTP Configuration

**Gmail Example:**
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
```

**Note:** For Gmail, enable 2FA and generate an App Password.

## API Endpoints

- `GET /api/rates` - Get current rates for all tokens
- `GET /api/rates/spreads` - Get spread analysis
- `GET /api/rates/:token` - Get rates for specific token (USDT/USDC)
- `GET /health` - Health check

## Testing

```bash
# Test WhatsApp notifications
pnpm run test:whatsapp

# Test email notifications
pnpm run test:email

# Type checking
pnpm run typecheck
```

## Building for Production

```bash
pnpm run build
pnpm start
```

## Project Structure

```
src/
├── domain/          # Domain types and errors
├── services/        # Business logic services
├── infrastructure/  # External services (Redis, WhatsApp, Email)
├── layers/          # Effect.ts layer composition
├── api/             # HTTP API routes
├── jobs/            # Background jobs (rate polling)
└── index.ts         # Application entry point
```

## Alert Configuration

Customize alert thresholds in `.env`:

```env
SPREAD_THRESHOLD=3      # Alert when spread > 3%
VOLATILITY_THRESHOLD=2  # Alert when rate changes > 2%
```

## License

MIT
