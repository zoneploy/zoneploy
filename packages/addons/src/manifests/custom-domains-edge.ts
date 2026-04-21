import { createAddonManifest } from "../module.js";

export const customDomainsEdgeManifest = createAddonManifest({
  slug: "custom-domains-edge",
  name: "Custom Domains Edge",
  category: "networking",
  description: "Terminates custom domains on this VPS and routes traffic to local services.",
  requiredCapabilities: ["linux-host", "docker", "docker-daemon", "traefik"],
  ports: [
    {
      port: 80,
      protocol: "tcp",
      reason: "Receives HTTP traffic and ACME HTTP challenges.",
      protected: true,
    },
    {
      port: 443,
      protocol: "tcp",
      reason: "Receives HTTPS traffic and terminates TLS.",
      protected: true,
    },
  ],
});
