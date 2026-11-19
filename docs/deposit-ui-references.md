# Crypto deposit UI references — 19 November 2026

The authenticated ABI deposit flow follows the common receive pattern documented by these official sources:

- [Kraken: How to deposit cryptocurrencies](https://support.kraken.com/articles/360000672643-how-to-deposit-cryptocurrencies-to-your-kraken-account). Its illustrated asset and network screens establish asset selection, a separate network choice, matching the sending network, then copying the receiving address or scanning a QR code.
- [Crypto.com: How to Deposit Crypto into the App/Web](https://help.crypto.com/en/articles/1972928-how-to-deposit-cryptocurrency-to-my-crypto-com-exchange-wallet). The web flow chooses a coin and network before showing deposit details; the app illustrates address and QR delivery.

The source pages and Kraken screenshots were retrieved and inspected during implementation. Search-engine HTML results were blocked or empty; the official guides were directly accessible. Their exchange branding, assets, supported networks, confirmation counts, minimums and account balances are not copied into ABI.

## ABI adaptation

Keep the current ABI identity. Receive in Billing now has separate Asset and Network selectors, a network-match reminder, a locally generated QR code and the complete server-verified address. Copy and explorer actions are bound to that selection. The QR image contains the exact address, not an invented payment request. The browser does not send addresses to a QR service.

Show only the actual API-supported assets and networks. No QR/address/copy action is offered while loading, after a failed selection change or when the receiving binding is unavailable. A successful refresh must re-establish it. Mainnet deposits remain separate from the Base Sepolia spending allowance; no confirmation count or minimum deposit is invented. Existing Send/Allocate review and authorization remain unchanged.

Settings follows the user's o11 Account/Team screenshot reference through compact tabs, unboxed sections, readable field labels and separators. Existing profile, access/security, compliance, invitation and approval controls remain; unsupported notification or avatar-upload controls are not added.

Activity and ledger transactions use continuous rows in the current page material, not independently white glass panels. Search has explicit separation from the results. The Billing tab strip ends after its last button and fits narrow mobile screens.

## Verification

A temporary browser fixture exercised 1440px, 390px and 320px layouts, clipboard copying, asset/network changes, failure masking, activity rows, transaction filtering and Account/Team keyboard navigation. A separate local QR decoder scanned rendered QR pixels and matched the address exactly. All test addresses and journal rows belonged only to that fixture, which was removed before deployment. These checks do not establish a real deposit or an authenticated production payment.
