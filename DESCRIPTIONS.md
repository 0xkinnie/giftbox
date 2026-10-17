# GiftBox — descriptions (paste-ready)

**Name: GiftBox** (a PayBox plugin — gift + PayBox).

## Tagline options
1. **Crypto gifts for people who don't do crypto.**
2. Gift a stock, some BTC, or stablecoins — they cash out to their bank. No wallet, no seed phrase.
3. A gift card, but the money is real and on-chain.

## Short (≤280 chars, counts verified)
- **A (202):** GiftBox lets an agent send real crypto — USDC, USDG, BTC, ETH, even tokenized NVDA stock — to anyone, no wallet needed. They claim with a code, get a free MoonPay wallet, and can cash out to their bank.
- **B (210):** Send anyone real crypto as a gift: stablecoins, BTC, ETH, or tokenized stocks from a verified catalog. No wallet needed to receive — claim with a code, get a MoonPay wallet, cash out to a bank via MoonPay Sell.
- **C (215):** Crypto gifts for people who don't do crypto. Pick USDC, BTC, ETH or a tokenized stock; GiftBox creates the gift card, e-card and claim code. Recipients cash out to their bank with MoonPay. No escrow, cancel anytime.
- **D (203):** Gift real crypto to anyone — even 0.5 shares of tokenized NVDA — with zero crypto knowledge needed. They claim with a code, receive it in a MoonPay wallet, and can sell it straight to their bank account.

## Medium
GiftBox turns real crypto into a gift anyone can receive. The sender's agent picks from a curated, explorer-verified catalog — stablecoins (USDC on Base, USDG on Robinhood Chain), BTC (cbBTC on Base), ETH, and tokenized stocks (NVDA, AAPL, TSLA, GOOGL on both chains; META, MSFT, AMZN on Base) — and creates a gift with a claim code, an e-card image, and a ready-to-send gift card. No funds move and nothing is locked in escrow. The recipient, who may never have touched crypto, creates a free MoonPay account to get a wallet address, presents the code, and the sender's PayBox wallet pays them directly after a passkey approval. From there they can keep the token or sell it in MoonPay and withdraw to a bank account or card. Unclaimed gifts cost nothing and can be cancelled anytime. Six tools: create_gift, create_ecard, check_gift, prepare_claim, mark_claimed, cancel_gift. The plugin never holds funds or keys — PayBox executes every payment.

## X caption (demo video)
I built GiftBox for the @MoonPay PayBox hackathon 🎁

Send anyone real crypto — even 0.5 shares of tokenized NVDA — even if they have NO wallet. They claim it with a code, get a MoonPay wallet, and can cash straight out to their bank.

Curated catalog only, so a gift can never be a scam clone. No escrow. Sender pays only when it's claimed.

## Facts box
- Chains: Base (8453), Robinhood Chain (4663)
- Tools: create_gift, create_ecard (SVG e-card + copy-able data-URI link), check_gift, prepare_claim (unsigned PayBox proposal), mark_claimed, cancel_gift
- Catalog (all contracts verified 2026-10-17 vs explorer/CoinGecko): USDC 0x833589…2913 (Base, 6dp) · USDG 0x5fc536…d168 (RH, 6dp) · cbBTC 0xcbB7C0…33Bf (Base, 8dp) · native ETH · Base B20 stocks (8dp): NVDA/AAPL/TSLA/GOOGL/META/MSFT/AMZN · Robinhood Token stocks (18dp): NVDA 0xd0601c…9eec, AAPL, TSLA, GOOGL
- BTC on Robinhood Chain is deliberately NOT offered: cbBTC trades there via Chainlink CCIP but its contract could not be verified against an authoritative source, so the catalog refuses rather than guess. During research a supply-cloned fake "NVIDIA • Robinhood Token" (0xd06033…) was found trading ~3% off the real price — the catalog lists only the CoinGecko-tracked contract.
- Network/hosts: none — fully offline logic; payments are unsigned proposals executed by PayBox
- Custody: none. No funds locked, no keys held, cancel anytime before claim; unclaimed gifts expire
- Cash-out path: MoonPay Sell → bank account / card (recipient-side, in MoonPay; ~$20 min, fees from ~1%)
