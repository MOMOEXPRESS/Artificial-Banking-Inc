import { z } from "zod";

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
const webUrl = z
  .string()
  .max(500)
  .refine((s) => {
    try {
      const u = new URL(s);
      return u.protocol === "https:" && !u.username && !u.password && !u.search && !u.hash;
    } catch {
      return false;
    }
  }, "Use an HTTPS URL without credentials, query parameters or fragments");
const optionalUrl = z.union([z.literal(""), webUrl]);
const logo = z.union([
  z.literal(""),
  webUrl,
  z
    .string()
    .max(24000)
    .regex(
      /^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/,
      "Use an HTTPS image URL or a small PNG, WebP or JPEG upload",
    ),
]);
export const serviceListingSchema = z
  .object({
    logo: logo.default(""),
    website: optionalUrl.default(""),
    docs: optionalUrl.default(""),
    baseUrl: webUrl,
    authentication: z
      .object({
        type: z.enum(["none", "bearer", "api_key_header", "api_key_query"]),
        name: z
          .string()
          .max(100)
          .regex(/^[A-Za-z0-9_-]*$/, "Use a header or parameter name, not a credential")
          .default(""),
      })
      .strict()
      .superRefine((a, ctx) => {
        if (["api_key_header", "api_key_query"].includes(a.type) && !a.name)
          ctx.addIssue({
            code: "custom",
            path: ["name"],
            message: "Enter the API key header or query parameter name",
          });
        if (["none", "bearer"].includes(a.type) && a.name)
          ctx.addIssue({
            code: "custom",
            path: ["name"],
            message: "Only API key authentication uses a custom name",
          });
      }),
    endpoints: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(120),
            method: z.enum(HTTP_METHODS),
            path: z
              .string()
              .max(500)
              .regex(/^\/(?!\/)[^\s?#]*$/, "Start with / and omit query strings or credentials"),
            description: z.string().trim().min(1).max(2000),
            resource: z.enum(["public_data", "customer_data", "owned_resource"]),
            pricing: z
              .object({
                model: z.enum(["free", "per_call", "usage_based"]),
                amount: z
                  .string()
                  .max(30)
                  .regex(
                    /^(0|[1-9]\d*)(\.\d{1,8})?$/,
                    "Enter a non-negative amount with at most eight decimal places",
                  )
                  .or(z.literal("")),
                currency: z.enum(["USD", "USDC"]),
                unit: z.string().trim().max(100),
                billingTerms: z.string().trim().max(2000),
              })
              .strict()
              .superRefine((p, ctx) => {
                if (p.model !== "free" && !p.billingTerms)
                  ctx.addIssue({
                    code: "custom",
                    path: ["billingTerms"],
                    message: "Describe how this endpoint is billed",
                  });
                if (p.model === "per_call" && !p.amount)
                  ctx.addIssue({
                    code: "custom",
                    path: ["amount"],
                    message: "Enter the price per call",
                  });
                if (p.model === "free" && p.amount && Number(p.amount) !== 0)
                  ctx.addIssue({
                    code: "custom",
                    path: ["amount"],
                    message: "A free endpoint cannot have a nonzero price",
                  });
              }),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict()
  .superRefine((s, ctx) => {
    const seen = new Set<string>();
    s.endpoints.forEach((e, i) => {
      const key = `${e.method} ${e.path}`;
      if (seen.has(key))
        ctx.addIssue({
          code: "custom",
          path: ["endpoints", i, "path"],
          message: "Each method and path must be unique",
        });
      seen.add(key);
    });
  });
export type ServiceListing = z.infer<typeof serviceListingSchema>;
export const emptyServiceListing = (): ServiceListing => ({
  logo: "",
  website: "",
  docs: "",
  baseUrl: "",
  authentication: { type: "none", name: "" },
  endpoints: [
    {
      name: "",
      method: "GET",
      path: "/",
      description: "",
      resource: "public_data",
      pricing: { model: "free", amount: "", currency: "USD", unit: "", billingTerms: "" },
    },
  ],
});
