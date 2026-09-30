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
Edit `backend/.env`:
```env
PORT=3000
PAYHERE_MERCHANT_ID=your_merchant_id
PAYHERE_MERCHANT_SECRET=your_merchant_secret
PAYHERE_ENV=sandbox # or 'live'

# Master AI keys for your server
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
DEEPSEEK_API_KEY=sk-...
```

### 2. Start the Backend
```bash
cd backend
npm install
npm run build
npm start
```

### 3. Access Web Dashboard
Open [http://localhost:3000](http://localhost:3000) in your browser.
