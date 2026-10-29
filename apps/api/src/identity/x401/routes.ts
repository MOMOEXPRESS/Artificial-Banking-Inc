/**
 * Serves ABI's OAuth Client ID Metadata Document, whose URL is the OpenID4VP
 * client_id in ABI's signed x401 requests. Shape follows Proof's
 * createClientIdMetadataDocument (@proof.com/proof-vc-server 0.7.0).
 */
import type express from "express";
import { currentX401Verifier } from "./gate.js";

export const X401_CLIENT_METADATA_PATH = "/.well-known/abi-x401-client.json";

export function registerX401Routes(app: express.Express): void {
  app.get(X401_CLIENT_METADATA_PATH, async (_req, res) => {
    const { verifier } = currentX401Verifier();
    if (!verifier || new URL(verifier.config.clientId).pathname !== X401_CLIENT_METADATA_PATH) {
      return res.status(404).json({ error: { code: "NOT_FOUND" } });
    }
    const c = verifier.config;
    res.setHeader("cache-control", "public, max-age=300");
    res.json({
      client_id: c.clientId,
      client_name: c.clientName,
      redirect_uris: c.expectedOrigins,
      token_endpoint_auth_method: "private_key_jwt",
      jwks: { keys: [await verifier.publicJwk()] },
    });
  });
}
