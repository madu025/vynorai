# VynorAI Cloud Backend & PayHere Payment Gateway

Production-ready backend for **VynorAI** AI Coding Assistant subscription business.

## 🚀 Features
- **User Authentication**: Secure JWT login, registration, and VynorAI API Key generation (`vynor_live_...`).
- **PayHere Payment Integration**: 
  - Official MD5 hash generation for checkout requests.
  - PayHere IPN Webhook (`/api/payment/notify`) with MD5 signature validation.
  - Automatic subscription activation upon successful payment (LKR 2,500/month or LKR 25,000/year).
- **OpenAI-Compatible AI Gateway**:
  - `/v1/chat/completions` (Chat, Edit, Apply)
  - `/v1/completions` (Autocomplete)
  - Token-level authorization & active subscription validation.
  - Real-time streaming response (SSE).
- **Web Dashboard**: High-converting, modern UI at `http://localhost:3000` for user registration, PayHere checkout, and API key management.

---

## 🛠️ Setup & Running

### 1. Configure Environment Variables

Production startup fails closed unless `JWT_SECRET`, `ADMIN_SECRET`, and
`DATA_ENCRYPTION_KEY` are configured. Use at least 32 random characters for
the first two. `DATA_ENCRYPTION_KEY` must contain exactly 32 random bytes,
encoded as 64 hexadecimal characters or base64 (for example,
`openssl rand -hex 32`). Store it in the deployment secret manager and back it
up separately; losing it makes encrypted API-key recovery impossible.

API keys are authenticated using SHA-256 digests. The recoverable copy needed
by the IDE login flow is encrypted at rest with AES-256-GCM. Passwords remain
one-way bcrypt hashes and cannot be decrypted.

Edit `backend/.env`:
```env
PORT=3000
JWT_SECRET=replace_with_at_least_32_random_characters
ADMIN_SECRET=replace_with_at_least_32_random_characters
DATA_ENCRYPTION_KEY=replace_with_64_hex_characters
PAYHERE_MERCHANT_ID=your_merchant_id
PAYHERE_MERCHANT_SECRET=your_merchant_secret
PAYHERE_ENV=sandbox # or 'live'

# Master AI keys for your server
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
DEEPSEEK_API_KEY=sk-...
VYNOR_PROVIDER_STRATEGY=openrouter-first # change after cost/quality measurement
```

OpenRouter requests ask for exact usage cost and enforce ZDR-capable routing.
The private `GET /admin/stats` response includes `economics24h`, separating
provider-reported cost from unknown cost instead of presenting estimates as
profit. `VYNOR_PROVIDER_STRATEGY=direct-first` is supported for compatible
DeepSeek, OpenAI, and Anthropic model families.

### 2. Start the Backend
```bash
cd backend
npm install
npm run build
npm start
```

### 3. Access Web Dashboard
Open [http://localhost:3000](http://localhost:3000) in your browser.
