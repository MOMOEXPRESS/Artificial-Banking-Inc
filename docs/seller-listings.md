# Seller listings and abi.yaml

The seller Inventory page has a full-width listing editor with **Form** and **abi.yaml** views. Tool/API services, software/digital products and physical products continue to use the existing seller-owned product records and publication controls.

## Service form

- Details: name, category, description, website, documentation URL, base URL and a logo URL or upload. PNG, JPEG and WebP uploads are reduced to a 128 px raster image and saved with the listing; the source file is limited to 2 MB and the stored image to 24,000 characters.
- Authentication: none, bearer token, API key in a header, or API key in a query parameter. Custom authentication stores only the header/parameter **name**. There is no credential-value field. Service objects reject unknown properties, including token/key-value fields.
- Endpoints: 1–30 entries with a name, method, relative path, description, resource classification and pricing. Methods: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS. Method/path pairs must be unique.
- Resource classification: public data, customer data, or customer-owned resource. This is a seller declaration, not a grant of access to customer data.
- Pricing: free, per call, usage-based/other; optional USD/USDC amount and billing unit, plus billing terms. Per-call prices require an amount; nonfree endpoints require billing terms. Amounts are decimal strings, with up to eight fractional digits.
- Availability: exact USDC checkout price, stock, an existing payment offer, images, variants and delivery metadata. The linked offer and publication requirements still apply.

Service URLs must use HTTPS without embedded credentials, query strings or fragments. Endpoint paths start with `/` and omit query strings and credentials. Secrets belong in a separate authorized connection flow, not a public listing.

## File and persistence contract

`schemaVersion: abi.listing.v1` identifies the portable listing file. Monetary checkout values use integer `priceMicro` strings: 1 USDC = 1,000,000 micro-units. Endpoint pricing is separate descriptive metadata.

The YAML editor accepts pasted edits, validates before returning to Form and preserves invalid text for correction. Copy and download export the current editor contents as `abi.yaml`. Files reject duplicate keys, aliases, unknown top-level/service properties and unsupported schema versions. Valid custom product attributes survive editing. Known variant and delivery attributes are validated before applying YAML.

On save, the adapter removes `schemaVersion` and moves the file’s top-level `service` object into `attributes.service` for the existing seller product POST/PUT APIs. The API validates service metadata using the same shared schema and stores it in the existing product attributes JSON. No database migration is necessary. Total attributes are limited to 64,000 serialized characters.

Reopening a listing restores its form and YAML data. Published product responses expose the same seller-declared service metadata to buyers and agents. Existing vendor identity, payout, offer ownership, price matching, reserved-stock and draft-on-edit checks are preserved.

## Billing and execution boundaries

Entering “USD 0.01 per 100 results, invoiced monthly” documents a vendor’s terms. It does not activate automatic usage billing, monthly invoicing, a credit line, a subscription or credential storage. ABI checkout still uses the linked payment offer and its existing execution/payment path. Declaring an endpoint’s method or authentication does not configure an authenticated proxy or automatically execute that endpoint.

## Seller audit — 8 November 2026

The pass traced seller session handling, Inventory create/edit, the payment-offer handoff, vendor identity, publication, order/fulfillment and returns/disputes navigation. The implementation work and browser verification concentrate on listing creation and editing. This is not a certification of live payment, shipping, account security or every seller screen.

Resolved findings:

| Severity | Finding | Resolution |
| --- | --- | --- |
| P1 | The product editor did not capture a structured service, authentication or multiple endpoints. | Added shared service contract and service-specific form sections. |
| P1 | No portable form/YAML round trip existed. | Added validated editing, copy and download, with invalid YAML preserved for correction. |
| P1 | Generic product attributes provided no service-specific validation. | Validate service metadata server-side before persistence; reject secret-bearing URL formats and unrecognized service/auth fields. |
| P2 | Saving the old form reconstructed attributes and could lose unexposed vendor metadata. | Preserve custom attributes while validating and editing known fields. |
| P2 | The narrow side editor was unsuitable for endpoint and billing details. | Use a focused full-width editor with responsive two-column/one-column fields. |
| P2 | Logo upload was unavailable. | Add bounded raster-image upload and a URL alternative. |
| P2 | New controls inherited conflicting button colors and required markers wrapped onto separate lines. | Scope neutral/primary action styles and group required labels. |

Verification:

- Shared file/data tests cover exact checkout money, all service fields, YAML edits, preserved custom attributes, duplicate keys/endpoints, aliases, unknown versions and credential-bearing input.
- Durable commerce tests cover save/read/publication and rejection before persistence, alongside existing seller ownership, checkout, stock and fulfillment tests.
- Synthetic browser runs at 1440 px and 390 px cover two endpoints, all seven method choices, logo upload, form/YAML round trips, invalid YAML recovery, file download, failed-save retry and reload/edit persistence; no page errors or horizontal overflow were observed.
- Browser fixtures use simulated API responses. No real customer accounts, credentials, payments, published inventory or fulfillment operations were created.
- Impeccable launcher/detector were unavailable. Product and design context were read directly; no detector certification or full WCAG conformance claim is made.

Review evidence is local under `.impeccable/review/seller-listing/`; the verification driver is `/tmp/abi-seller-listing-browser.cjs`.
