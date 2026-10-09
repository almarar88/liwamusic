# Velora — Banking App Simulator (Android)

A full-featured banking app **simulator**. Everything is local to the device: no real bank, no real money, no real market orders.

**Download:** [`download/Velora.apk`](../download/Velora.apk) · Demo PIN: `1234`

## Features

| Area | What it does |
|---|---|
| Home | Current account opening balance **AED 5,000,000.00**, IBAN, hide/show balance, savings pocket, investments, credit card due, recent activity, full statement with search, FX rates and converter |
| Cards | Platinum **Debit** (Visa) and Infinite **Credit** (Mastercard): freeze/unfreeze, reveal number/expiry/CVV (PIN-protected, auto-hides after 15 s), view card PIN, spending limits, toggles for online/international/contactless, credit limit meter, minimum due, pay the card bill |
| Transfer | Send to **any IBAN** (live format, country-length and mod-97 checksum validation; local vs SWIFT with fee), saved beneficiaries, purpose of payment, PIN authorisation and receipt; moves between own accounts; bill payments |
| Invest | US stocks (AAPL, NVDA, MSFT, TSLA, AMZN, GOOGL, META) and crypto (BTC, ETH, SOL, XRP, BNB, DOGE) with live-moving simulated prices, sparklines, charts, buy by AED amount, sell by units/percentage, portfolio value and P&L |
| Insights | Month-to-date spend vs same period last month, budget meter, 6-month bar chart, category donut (1/3/6 months), category breakdown, top merchants |
| Other | PIN lock + simulated fingerprint unlock, notifications, profile, reset demo to AED 5,000,000 |
| Design | Animated aurora background, glass panels, 3D cards (touch / gyroscope tilt, holographic shine, tap to flip), count-up balances, slide-to-confirm, custom PIN pad, confetti receipts, scrubbable price charts, animated donut / bars, haptic feedback, drag-to-dismiss sheets |

Every receipt is stamped *"SIMULATION · NO REAL FUNDS WERE MOVED"* and the header shows a **DEMO** badge.

## Build

```bash
cd velora
npm install
node scripts/selftest.mjs           # logic tests
npx cap add android && npx cap sync android
node scripts/patch-android.mjs android
python3 scripts/make-icons.py android/app/src/main/res
cd android && ./gradlew assembleRelease
```

CI: the **Build Velora** workflow (`.github/workflows/build-velora.yml`) builds and signs the APK on manual dispatch or on `velora-v*` tags.
