/**
 * Manifesto MV3 da extensão (F12-8: só o Chrome). Permissões mínimas: guardar o pareamento e falar com o narnia local
 * (127.0.0.1/localhost, qualquer porta). Ler a página aberta (`activeTab`, `scripting`) entra no M2. `extraHosts` só
 * existe no build do e2e, em que o narnia é `http://web` na rede do compose.
 */
export function buildManifest(version: string, extraHosts: string[] = []) {
  return {
    manifest_version: 3,
    name: "narnia-jobs",
    description: "Leva vagas e formulários de candidatura do navegador para o seu narnia local.",
    version,
    minimum_chrome_version: "120",
    icons: {
      "16": "icons/16.png",
      "32": "icons/32.png",
      "48": "icons/48.png",
      "128": "icons/128.png",
    },
    action: {
      default_title: "narnia-jobs",
      default_icon: { "16": "icons/16.png", "32": "icons/32.png" },
    },
    background: { service_worker: "background.js", type: "module" },
    options_ui: { page: "options.html", open_in_tab: true },
    permissions: ["storage"],
    host_permissions: [
      "http://127.0.0.1/*",
      "http://localhost/*",
      ...extraHosts.map((h) => `http://${h}/*`),
    ],
  };
}
