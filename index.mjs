import { jsx, jsxs } from "react/jsx-runtime";
const plugin = ({ React, ui, icons, store, sdk }) => {
  const { useState } = React;
  const readCode = async (spec) => {
    try {
      const toKey = (s) => s.replace(/[^a-zA-Z0-9_@.-]/g, "_");
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle("plugin-cache");
      const fh = await dir.getFileHandle(toKey(spec));
      return await (await fh.getFile()).text();
    } catch {
      return null;
    }
  };
  const getAppAssets = () => {
    const scripts = document.querySelectorAll("script[src]");
    const links = document.querySelectorAll('link[rel="stylesheet"]');
    let js = "", css = "";
    scripts.forEach((s) => {
      const src = s.getAttribute("src");
      if (src == null ? void 0 : src.includes("/assets/")) js = src;
    });
    links.forEach((l) => {
      const href = l.getAttribute("href");
      if (href == null ? void 0 : href.includes("/assets/")) css = href;
    });
    return { js, css };
  };
  const fetchAsset = async (url) => {
    const res = await fetch(url);
    return new Uint8Array(await res.arrayBuffer());
  };
  const buildConfig = (pluginSpecs) => {
    const entries = pluginSpecs.map((p) => ({
      pluginUri: `./${p.dirName}`
    }));
    return JSON.stringify(entries, null, 2);
  };
  const specToDir = (spec) => {
    if (spec.startsWith("store://")) return "plugin-" + spec.slice(8).replace(/[^a-zA-Z0-9_-]/g, "_");
    const repo = spec.split("@")[0];
    return repo.split("/").pop() || "plugin-unknown";
  };
  const buildHtml = (jsFile, cssFile) => {
    return `<!DOCTYPE html>
<html lang="pl" data-theme="dracula">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob: data: https://esm.sh https://cdn.jsdelivr.net; connect-src 'self' https://raw.githubusercontent.com https://esm.sh https://cdn.jsdelivr.net https://huggingface.co https://*.huggingface.co https://*.hf.co https://api.openai.com https://obieg-zero-store.gotoreadyai.workers.dev https://api.lemonsqueezy.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; worker-src 'self' blob: https://cdn.jsdelivr.net" />
  <link rel="icon" href="data:," />
  <title>Obieg Zero — standalone</title>
  <script type="importmap">
  {
    "imports": {
      "pdfjs-dist": "https://esm.sh/pdfjs-dist@4.10.38",
      "tesseract.js": "https://esm.sh/tesseract.js@5.1.1",
      "@huggingface/transformers": "https://esm.sh/@huggingface/transformers@3.4.1"
    }
  }
  <\/script>
  <script type="module" crossorigin src="./assets/${jsFile}"><\/script>
  <link rel="stylesheet" crossorigin href="./assets/${cssFile}">
</head>
<body>
  <div id="root"></div>
</body>
</html>`;
  };
  async function generateStandalone(setStatus) {
    setStatus("Pobieram liste zainstalowanych pluginow...");
    const installed = await sdk.getInstalledPlugins();
    if (installed.length === 0) {
      sdk.log("Brak zainstalowanych pluginow — zainstaluj cos przez Manager", "error");
      setStatus("");
      return;
    }
    setStatus(`Odczytuje kod ${installed.length} pluginow z OPFS...`);
    const pluginFiles = [];
    for (const p of installed) {
      const code = await readCode(p.spec);
      if (!code) {
        sdk.log(`Brak kodu w cache dla "${p.spec}" — pomijam`, "error");
        continue;
      }
      pluginFiles.push({ ...p, dirName: specToDir(p.spec), code });
    }
    if (pluginFiles.length === 0) {
      sdk.log("Zaden plugin nie ma kodu w OPFS cache", "error");
      setStatus("");
      return;
    }
    setStatus("Pobieram assety aplikacji...");
    const { js, css } = getAppAssets();
    if (!js || !css) {
      sdk.log("Nie znaleziono JS/CSS assetow na stronie", "error");
      setStatus("");
      return;
    }
    const jsData = await fetchAsset(js);
    const cssData = await fetchAsset(css);
    const jsFile = js.split("/").pop();
    const cssFile = css.split("/").pop();
    setStatus("Pobieram pliki statyczne...");
    const staticFiles = {};
    for (const name of ["workflows.json", "opponents.json"]) {
      try {
        const data = await fetchAsset(`./${name}`);
        staticFiles[name] = data;
      } catch {
      }
    }
    setStatus("Pakuje standalone...");
    const zipFiles = {};
    zipFiles["index.html"] = buildHtml(jsFile, cssFile);
    zipFiles[`assets/${jsFile}`] = jsData;
    zipFiles[`assets/${cssFile}`] = cssData;
    zipFiles["favicon.ico"] = "";
    zipFiles["config.json"] = buildConfig(pluginFiles);
    for (const [name, data] of Object.entries(staticFiles)) {
      zipFiles[name] = data;
    }
    for (const p of pluginFiles) {
      zipFiles[`${p.dirName}/index.mjs`] = p.code;
    }
    zipFiles["serve.sh"] = `#!/bin/bash
echo "Obieg Zero standalone — http://localhost:3000"
npx serve -s . -l 3000
`;
    const blob = sdk.zip(zipFiles);
    setStatus("Pobieram paczke...");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `obieg-zero-standalone-${Date.now()}.zip`;
    a.click();
    URL.revokeObjectURL(url);
    sdk.log(`Standalone spakowany: ${pluginFiles.length} pluginow, ${Object.keys(zipFiles).length} plikow`, "ok");
    setStatus("");
  }
  function Center() {
    const [installed, setInstalled] = useState([]);
    const [status, setStatus] = useState("");
    sdk.getAllPlugins();
    React.useEffect(() => {
      sdk.getInstalledPlugins().then(setInstalled);
    }, []);
    const generating = status !== "";
    return /* @__PURE__ */ jsx(ui.Page, { children: /* @__PURE__ */ jsx(ui.Card, { title: "Eksport standalone", children: /* @__PURE__ */ jsxs(ui.Stack, { gap: "md", children: [
      /* @__PURE__ */ jsxs(ui.Text, { children: [
        "Generuje paczke ZIP z biezaca aplikacja i zainstalowanymi pluginami. Rozpakuj i uruchom ",
        /* @__PURE__ */ jsx(ui.Badge, { children: "./serve.sh" }),
        " lub ",
        /* @__PURE__ */ jsx(ui.Badge, { children: "npx serve -s . -l 3000" })
      ] }),
      installed.length === 0 ? /* @__PURE__ */ jsx(ui.Text, { muted: true, children: "Brak zainstalowanych pluginow. Uzyj Managera zeby zainstalowac pluginy." }) : /* @__PURE__ */ jsxs(ui.Stack, { gap: "sm", children: [
        /* @__PURE__ */ jsx(ui.Heading, { title: `Pluginy do spakowania (${installed.length})` }),
        installed.map((p) => /* @__PURE__ */ jsx(ui.ListItem, { label: p.label, detail: p.spec }, p.spec))
      ] }),
      status && /* @__PURE__ */ jsx(ui.Text, { muted: true, children: status }),
      /* @__PURE__ */ jsx(
        ui.Button,
        {
          color: "primary",
          disabled: generating || installed.length === 0,
          onClick: () => generateStandalone(setStatus),
          children: generating ? "Generowanie..." : "Pobierz standalone ZIP"
        }
      )
    ] }) }) });
  }
  sdk.registerView("standalone.center", { slot: "center", component: Center });
  return {
    id: "plugin-standalone",
    label: "Standalone",
    version: "0.1.0",
    description: "Eksport zainstalowanych pluginow jako standalone paczka",
    icon: icons.Download
  };
};
export {
  plugin as default
};
