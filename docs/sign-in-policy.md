# Sign-in requirements

At the user's request, ABI sign-in uses a verified email/password or a verified Google/GitHub identity without an additional ABI authenticator or recovery-code prompt. This applies to buyer login, legacy seller login and social identity completion. New and historical frontend deployments use the same server policy; refreshing an older login page clears a previously displayed factor prompt.

Password verification, disabled-account checks, email verification, provider session validation, explicit identity linking, CSRF protection, HttpOnly sessions and rate limits remain. A matching email alone does not link an existing account. Social sign-in does not fabricate a higher provider assurance level.

Existing authenticator enrollment and recovery-code records are retained. Sign-in does not consume them. Explicit sensitive actions, including high-value approval step-up and seller payout changes, retain their existing checks. No account, secret or financial record is deleted by this release.

Tests cover buyer and seller password login with an enrolled factor, rejection of wrong passwords, verified social sign-in, preservation of factor state and the existing sensitive-action checks. UI checks verify that sign-in forms submit without factor fields or an authenticator prompt.
