# CAPTCHA removed from authentication

At the user's request, Turnstile is removed from buyer/seller sign-in and sign-up. Current forms do not load its script, render its widget, collect tokens or call Siteverify. Existing password/social authentication, MFA, session protection, email verification and rate limits continue to apply.

The compatibility endpoint `GET /v1/auth/challenge` always returns `{ "enabled": false, "sitekey": null }` with `Cache-Control: no-store`. Older immutable deployment pages, including the URL previously reporting 110200, therefore stop requiring CAPTCHA after refresh. Stored Turnstile credentials are inactive and are not forwarded into the API runtime. They are retained rather than irreversibly deleted; adding a credential cannot reactivate the removed integration.

The earlier 110200 incident came from a historical production deployment hostname missing from the widget's domain list. That hostname registration was corrected before the user requested complete removal. Production deployment URLs still normalize automatically to the stable website on new builds; this also keeps users on the current release.

Regression checks exercise the compatibility endpoint and actual buyer/seller authentication routes with inactive credentials present, ensuring credentials do not re-enable CAPTCHA and invalid logins remain rejected.
