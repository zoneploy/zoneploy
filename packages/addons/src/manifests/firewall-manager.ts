import { createAddonManifest } from "../module.js";

export const firewallManagerManifest = createAddonManifest({
  slug: "firewall-manager",
  name: "Firewall Manager",
  category: "security",
  description: "Installs, activates and manages a supported firewall backend.",
  requiredCapabilities: ["linux-host", "systemd", "package-manager"],
  ports: [],
});
