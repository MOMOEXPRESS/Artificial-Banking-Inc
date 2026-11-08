"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import NextImage from "next/image";
import { ArrowLeft, Copy, Download, FileCode2, ImagePlus, Plus, Trash2 } from "lucide-react";
import { HTTP_METHODS, emptyServiceListing, type ServiceListing } from "@policyvault/common";
import {
  listingDraft,
  draftManifest,
  serializeListing,
  parseListing,
  manifestDraft,
  listingPayload,
  manifestSchema,
  type ListingDraft,
} from "./listing-manifest";
import type { MarketplaceProduct } from "./marketplace-catalog";

type Product = MarketplaceProduct & { offerId?: string };
type Props = {
  product?: Product;
  offers: { id: string; title: string }[];
  onSave: (payload: ReturnType<typeof listingPayload>) => Promise<void>;
  onClose: () => void;
};
export function SellerListingEditor({ product, offers, onSave, onClose }: Props) {
  const [draft, setDraft] = useState(() => listingDraft(product));
  const [mode, setMode] = useState<"form" | "yaml">("form"),
    [yaml, setYaml] = useState("");
  const [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const errorRef = useRef<HTMLDivElement>(null),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  const set = (key: keyof ListingDraft, value: string) => setDraft((d) => ({ ...d, [key]: value }));
  function service(next: ServiceListing) {
    setDraft((d) => ({ ...d, service: next }));
  }
  function switchMode(next: "form" | "yaml") {
    if (next === mode) return;
    setError("");
    setNotice("");
    if (next === "yaml") {
      setYaml(serializeListing(draft));
      setMode(next);
      return;
    }
    try {
      setDraft(manifestDraft(parseListing(yaml)));
      setMode(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check your YAML.");
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    try {
      const m = mode === "yaml" ? parseListing(yaml) : manifestSchema.parse(draftManifest(draft));
      setBusy(true);
      await onSave(listingPayload(m));
    } catch (e) {
      const issues = (e as { issues?: { path: (string | number)[]; message: string }[] })?.issues;
      setError(
        issues?.length
          ? `${issues[0].path.join(".")}: ${issues[0].message}`
          : e instanceof Error
            ? e.message
            : "Could not save. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  const yamlText = () => (mode === "yaml" ? yaml : serializeListing(draft));
  async function copy() {
    try {
      await navigator.clipboard.writeText(yamlText());
      setNotice("abi.yaml copied.");
    } catch {
      setError("Clipboard access was denied. Download abi.yaml instead.");
    }
  }
  function download() {
    const u = URL.createObjectURL(new Blob([yamlText()], { type: "application/yaml" }));
    const a = document.createElement("a");
    a.href = u;
    a.download = "abi.yaml";
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  }
  async function logo(file?: File) {
    if (!file) return;
    setError("");
    setNotice("");
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 2 * 1024 * 1024
    ) {
      setError("Choose a PNG, JPEG or WebP image up to 2 MB.");
      return;
    }
    setUploading(true);
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw Error("Image processing is unavailable. Use an HTTPS logo URL instead.");
      const scale = Math.min(128 / image.width, 128 / image.height);
      ctx.drawImage(
        image,
        (128 - image.width * scale) / 2,
        (128 - image.height * scale) / 2,
        image.width * scale,
        image.height * scale,
      );
      const data = canvas.toDataURL("image/webp", 0.8);
      if (data.length > 24000)
        throw Error("This logo is too detailed. Choose a simpler image or use an HTTPS logo URL.");
      if (mounted.current) {
        setDraft((d) => ({ ...d, service: { ...d.service, logo: data } }));
        setNotice("Logo ready. Save the listing to keep it.");
      }
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : "Could not read the logo. Try another image.");
    } finally {
      URL.revokeObjectURL(url);
      if (mounted.current) setUploading(false);
    }
  }
  const disabled = busy || uploading;
  return (
    <section className="seller-listing-editor" aria-label="Listing editor">
      <button type="button" className="listing-back" onClick={onClose} disabled={disabled}>
        <ArrowLeft size={17} />
        Listings
      </button>
      <div className="listing-editor-heading">
        <h2>{product ? "Edit listing" : "New listing"}</h2>
        <div className="listing-file-actions">
          <button type="button" onClick={() => void copy()} disabled={disabled}>
            <Copy size={16} />
            Copy YAML
          </button>
          <button type="button" onClick={download} disabled={disabled}>
            <Download size={16} />
            abi.yaml
          </button>
        </div>
      </div>
      <div className="market-tabs listing-mode" role="group" aria-label="Listing format">
        <button
          type="button"
          aria-pressed={mode === "form"}
          onClick={() => switchMode("form")}
          disabled={disabled}
        >
          Form
        </button>
        <button
          type="button"
          aria-pressed={mode === "yaml"}
          onClick={() => switchMode("yaml")}
          disabled={disabled}
        >
          <FileCode2 size={16} />
          abi.yaml
        </button>
      </div>
      {error && (
        <div className="listing-feedback" role="alert" tabIndex={-1} ref={errorRef}>
          <strong>Check your listing</strong>
          <p>{error}</p>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      <form onSubmit={submit} noValidate>
        <fieldset disabled={disabled} className="listing-fields">
          {mode === "yaml" ? (
            <section className="listing-yaml">
              <label htmlFor="listing-yaml">abi.yaml</label>
              <p>
                The same listing in a portable file. Returning to Form validates and applies your
                edits. Keep API tokens and customer data out of this public file.
              </p>
              <textarea
                id="listing-yaml"
                spellCheck={false}
                value={yaml}
                onChange={(e) => setYaml(e.target.value)}
                rows={28}
              />
            </section>
          ) : (
            <>
              <section className="listing-section">
                <h3>Details</h3>
                <div className="listing-grid">
                  <label>
                    Listing type
                    <select value={draft.kind} onChange={(e) => set("kind", e.target.value)}>
                      <option value="service">Tool / API service</option>
                      <option value="digital">Software / digital product</option>
                      <option value="physical">Physical goods</option>
                    </select>
                  </label>
                  <label>
                    <span>
                      Category <span aria-hidden="true">*</span>
                    </span>
                    <input
                      required
                      value={draft.category}
                      maxLength={80}
                      onChange={(e) => set("category", e.target.value)}
                      placeholder="e.g. Search & research"
                    />
                  </label>
                  <label className="listing-wide">
                    <span>
                      Name <span aria-hidden="true">*</span>
                    </span>
                    <input
                      required
                      value={draft.name}
                      maxLength={200}
                      onChange={(e) => set("name", e.target.value)}
                      placeholder="Your product or service name"
                    />
                  </label>
                  {draft.kind === "service" && (
                    <>
                      <div className="listing-wide listing-logo-row">
                        {draft.service.logo && (
                          <NextImage
                            unoptimized
                            width={56}
                            height={56}
                            src={draft.service.logo}
                            alt="Listing logo"
                          />
                        )}
                        <label className="listing-upload">
                          <ImagePlus size={18} />
                          {uploading ? "Preparing logo…" : "Upload logo"}
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            onChange={(e) => {
                              void logo(e.target.files?.[0]);
                              e.target.value = "";
                            }}
                          />
                        </label>
                        {draft.service.logo && (
                          <button
                            type="button"
                            onClick={() => service({ ...draft.service, logo: "" })}
                          >
                            Remove logo
                          </button>
                        )}
                        <p>PNG, JPEG or WebP · up to 2 MB</p>
                      </div>
                      <label className="listing-wide">
                        Or use a logo URL
                        <input
                          type="url"
                          value={draft.service.logo.startsWith("data:") ? "" : draft.service.logo}
                          onChange={(e) => service({ ...draft.service, logo: e.target.value })}
                          placeholder="https://example.com/logo.png"
                        />
                      </label>
                      <label>
                        Website
                        <input
                          type="url"
                          value={draft.service.website}
                          onChange={(e) => service({ ...draft.service, website: e.target.value })}
                          placeholder="https://example.com"
                        />
                      </label>
                      <label>
                        Documentation
                        <input
                          type="url"
                          value={draft.service.docs}
                          onChange={(e) => service({ ...draft.service, docs: e.target.value })}
                          placeholder="https://docs.example.com"
                        />
                      </label>
                      <label className="listing-wide">
                        <span>
                          Base URL <span aria-hidden="true">*</span>
                        </span>
                        <input
                          required
                          type="url"
                          value={draft.service.baseUrl}
                          onChange={(e) => service({ ...draft.service, baseUrl: e.target.value })}
                          placeholder="https://api.example.com/v1"
                        />
                      </label>
                    </>
                  )}
                  <label className="listing-wide">
                    <span>
                      Description <span aria-hidden="true">*</span>
                    </span>
                    <textarea
                      required
                      value={draft.description}
                      maxLength={4000}
                      onChange={(e) => set("description", e.target.value)}
                      rows={4}
                      placeholder="What does this listing provide, and who is it for?"
                    />
                  </label>
                </div>
              </section>
              {draft.kind === "service" && (
                <>
                  <section className="listing-section">
                    <h3>Authentication</h3>
                    <p>
                      Describe how customers authenticate. Never enter an actual token or API key
                      here.
                    </p>
                    <div className="listing-grid">
                      <label>
                        Method
                        <select
                          value={draft.service.authentication.type}
                          onChange={(e) =>
                            service({
                              ...draft.service,
                              authentication: {
                                type: e.target.value as ServiceListing["authentication"]["type"],
                                name: "",
                              },
                            })
                          }
                        >
                          <option value="none">None</option>
                          <option value="bearer">Bearer token</option>
                          <option value="api_key_header">API key in header</option>
                          <option value="api_key_query">API key in query parameter</option>
                        </select>
                      </label>
                      {["api_key_header", "api_key_query"].includes(
                        draft.service.authentication.type,
                      ) && (
                        <label>
                          <span>
                            {draft.service.authentication.type === "api_key_header"
                              ? "Header name"
                              : "Query parameter name"}{" "}
                            <span aria-hidden="true">*</span>
                          </span>
                          <input
                            required
                            value={draft.service.authentication.name}
                            maxLength={100}
                            onChange={(e) =>
                              service({
                                ...draft.service,
                                authentication: {
                                  ...draft.service.authentication,
                                  name: e.target.value,
                                },
                              })
                            }
                            placeholder={
                              draft.service.authentication.type === "api_key_header"
                                ? "X-API-Key"
                                : "api_key"
                            }
                          />
                        </label>
                      )}
                    </div>
                    {draft.service.authentication.type === "bearer" && (
                      <p>Customers supply their token using the Authorization: Bearer header.</p>
                    )}
                  </section>
                  <section className="listing-section">
                    <div className="listing-section-heading">
                      <div>
                        <h3>Endpoints</h3>
                        <p>
                          Explain what each endpoint does, which resources it uses and how it is
                          billed.
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={draft.service.endpoints.length >= 30}
                        onClick={() =>
                          service({
                            ...draft.service,
                            endpoints: [
                              ...draft.service.endpoints,
                              emptyServiceListing().endpoints[0],
                            ],
                          })
                        }
                      >
                        <Plus size={17} />
                        Add endpoint
                      </button>
                    </div>
                    {draft.service.endpoints.map((ep, i) => {
                      function endpoint(next: typeof ep) {
                        service({
                          ...draft.service,
                          endpoints: draft.service.endpoints.map((v, j) => (j === i ? next : v)),
                        });
                      }
                      return (
                        <fieldset className="listing-endpoint" key={i}>
                          <legend>
                            Endpoint {i + 1}
                            {ep.name ? ` · ${ep.name}` : ""}
                          </legend>
                          <div className="listing-grid">
                            <label className="listing-wide">
                              <span>
                                Endpoint name <span aria-hidden="true">*</span>
                              </span>
                              <input
                                required
                                maxLength={120}
                                value={ep.name}
                                onChange={(e) => endpoint({ ...ep, name: e.target.value })}
                                placeholder="e.g. Web search"
                              />
                            </label>
                            <label>
                              HTTP method
                              <select
                                value={ep.method}
                                onChange={(e) =>
                                  endpoint({ ...ep, method: e.target.value as typeof ep.method })
                                }
                              >
                                {HTTP_METHODS.map((m) => (
                                  <option key={m}>{m}</option>
                                ))}
                              </select>
                            </label>
                            <label>
                              <span>
                                Path <span aria-hidden="true">*</span>
                              </span>
                              <input
                                required
                                value={ep.path}
                                maxLength={500}
                                onChange={(e) => endpoint({ ...ep, path: e.target.value })}
                                placeholder="/search"
                              />
                            </label>
                            <label className="listing-wide">
                              <span>
                                Endpoint description <span aria-hidden="true">*</span>
                              </span>
                              <textarea
                                required
                                rows={2}
                                maxLength={2000}
                                value={ep.description}
                                onChange={(e) => endpoint({ ...ep, description: e.target.value })}
                                placeholder="Returns ranked results for a search query."
                              />
                            </label>
                            <label className="listing-wide">
                              Whose data or resource does it access?
                              <select
                                value={ep.resource}
                                onChange={(e) =>
                                  endpoint({
                                    ...ep,
                                    resource: e.target.value as typeof ep.resource,
                                  })
                                }
                              >
                                <option value="public_data">Public data</option>
                                <option value="customer_data">Customer data</option>
                                <option value="owned_resource">Customer-owned resource</option>
                              </select>
                            </label>
                            <label>
                              Pricing
                              <select
                                value={ep.pricing.model}
                                onChange={(e) =>
                                  endpoint({
                                    ...ep,
                                    pricing: {
                                      ...ep.pricing,
                                      model: e.target.value as typeof ep.pricing.model,
                                      amount: "",
                                    },
                                  })
                                }
                              >
                                <option value="free">Free</option>
                                <option value="per_call">Per call</option>
                                <option value="usage_based">Usage-based or other</option>
                              </select>
                            </label>
                            {ep.pricing.model !== "free" && (
                              <>
                                <label>
                                  Currency
                                  <select
                                    value={ep.pricing.currency}
                                    onChange={(e) =>
                                      endpoint({
                                        ...ep,
                                        pricing: {
                                          ...ep.pricing,
                                          currency: e.target.value as "USD" | "USDC",
                                        },
                                      })
                                    }
                                  >
                                    <option>USD</option>
                                    <option>USDC</option>
                                  </select>
                                </label>
                                <label>
                                  Amount{" "}
                                  {ep.pricing.model === "per_call" ? "per call" : "(optional)"}
                                  <input
                                    inputMode="decimal"
                                    value={ep.pricing.amount}
                                    onChange={(e) =>
                                      endpoint({
                                        ...ep,
                                        pricing: { ...ep.pricing, amount: e.target.value },
                                      })
                                    }
                                    placeholder="0.01"
                                  />
                                </label>
                                <label>
                                  Billing unit
                                  <input
                                    value={ep.pricing.unit}
                                    maxLength={100}
                                    onChange={(e) =>
                                      endpoint({
                                        ...ep,
                                        pricing: { ...ep.pricing, unit: e.target.value },
                                      })
                                    }
                                    placeholder="e.g. 100 results"
                                  />
                                </label>
                              </>
                            )}
                            <label className="listing-wide">
                              <span>
                                Billing terms{" "}
                                {ep.pricing.model !== "free" && <span aria-hidden="true">*</span>}
                              </span>
                              <textarea
                                rows={2}
                                required={ep.pricing.model !== "free"}
                                value={ep.pricing.billingTerms}
                                maxLength={2000}
                                onChange={(e) =>
                                  endpoint({
                                    ...ep,
                                    pricing: { ...ep.pricing, billingTerms: e.target.value },
                                  })
                                }
                                placeholder="e.g. USD 0.01 per 100 results, invoiced monthly."
                              />
                            </label>
                          </div>
                          <button
                            type="button"
                            className="listing-remove"
                            disabled={draft.service.endpoints.length === 1}
                            aria-label={`Remove endpoint ${i + 1}`}
                            onClick={() =>
                              service({
                                ...draft.service,
                                endpoints: draft.service.endpoints.filter((_, j) => i !== j),
                              })
                            }
                          >
                            <Trash2 size={16} />
                            Remove endpoint
                          </button>
                        </fieldset>
                      );
                    })}
                  </section>
                </>
              )}
              <section className="listing-section">
                <h3>Availability & checkout</h3>
                <p>
                  Endpoint billing terms describe the provider’s pricing. ABI checkout uses the
                  linked payment offer; this form does not enable monthly usage invoicing.
                </p>
                <div className="listing-grid">
                  <label>
                    <span>
                      Checkout price (USDC) <span aria-hidden="true">*</span>
                    </span>
                    <input
                      required
                      inputMode="decimal"
                      value={draft.priceUsdc}
                      onChange={(e) => set("priceUsdc", e.target.value)}
                      placeholder="0.10"
                    />
                  </label>
                  <label>
                    <span>
                      Available stock <span aria-hidden="true">*</span>
                    </span>
                    <input
                      required
                      type="number"
                      min="0"
                      max="1000000000"
                      step="1"
                      value={draft.stockLevel}
                      onChange={(e) => set("stockLevel", e.target.value)}
                    />
                  </label>
                  {draft.kind !== "physical" && (
                    <label className="listing-wide">
                      Payment offer
                      <select
                        value={draft.offerId}
                        onChange={(e) => set("offerId", e.target.value)}
                      >
                        <option value="">Choose before publishing</option>
                        {offers.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.title}
                          </option>
                        ))}
                      </select>
                      <span className="listing-help">
                        Publication requires a published offer you own, at the same checkout price.
                      </span>
                    </label>
                  )}
                  <label className="listing-wide">
                    Product image URLs
                    <textarea
                      rows={2}
                      value={draft.images}
                      onChange={(e) => set("images", e.target.value)}
                      placeholder="One HTTPS URL per line"
                    />
                  </label>
                </div>
                <details>
                  <summary>Variants & delivery</summary>
                  <div className="listing-grid">
                    {(
                      [
                        ["colors", "Colors"],
                        ["sizes", "Sizes"],
                        ["regions", "Delivery regions"],
                        ["useCases", "Use cases"],
                        ["deliveryDays", "Estimated delivery days"],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key}>
                        {label}
                        <input
                          value={draft[key]}
                          onChange={(e) => set(key, e.target.value)}
                          {...(key === "deliveryDays"
                            ? { type: "number", min: 0, max: 365, step: 1 }
                            : { placeholder: "Separate values with commas" })}
                        />
                      </label>
                    ))}
                  </div>
                </details>
              </section>
            </>
          )}
        </fieldset>
        <div className="listing-save-actions">
          <p>Saved as a draft. Review and publish from your listings.</p>
          <div>
            <button type="button" disabled={disabled} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="listing-primary" disabled={disabled}>
              {busy ? "Saving…" : uploading ? "Preparing logo…" : "Save listing draft"}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
