import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import config from "../config.js";

const pluginsPath = path.join(process.cwd(), "plugins/kavya");
const SKIP_PLUGIN_DIRS = new Set(["HANDLERS"]);
let plugins = [];

function isApiDependentPlugin(fullPath) {
  try {
    const source = fs.readFileSync(fullPath, "utf8");
    return source.includes("api-autoresbot");
  } catch (error) {
    console.error(`ERROR: Gagal membaca plugin: ${fullPath} - ${error.message}`);
    return false;
  }
}

async function loadPlugins(directory, loadState = { skippedApiPlugins: [] }) {
  const loadedPlugins = [];

  try {
    const files = fs.readdirSync(directory);

    for (const file of files) {
      const fullPath = path.join(directory, file);
      const stats = fs.statSync(fullPath);

      if (stats.isDirectory()) {
        if (SKIP_PLUGIN_DIRS.has(file.toUpperCase())) {
          continue;
        }
        const subPlugins = await loadPlugins(fullPath, loadState);
        loadedPlugins.push(...subPlugins);
        continue;
      }

      if (!file.endsWith(".js")) {
        continue;
      }

      try {
        if (!config.hasApiKey && isApiDependentPlugin(fullPath)) {
          loadState.skippedApiPlugins.push(path.relative(pluginsPath, fullPath));
          continue;
        }

        const plugin = await import(
          pathToFileURL(fullPath).href + "?cacheBust=" + Date.now()
        );
        loadedPlugins.push(plugin.default || plugin);
      } catch (error) {
        console.error(`ERROR: Gagal memuat plugin: ${fullPath} : ${error}`);
      }
    }
  } catch (error) {
    console.error(`ERROR: Gagal membaca direktori: ${directory} - ${error.message}`);
  }

  return loadedPlugins;
}

function logSkippedApiPlugins(skippedApiPlugins) {
  if (skippedApiPlugins.length === 0) {
    return;
  }

  const preview = skippedApiPlugins.slice(0, 5).join(", ");
  const extraCount = skippedApiPlugins.length - 5;
  const extraText = extraCount > 0 ? `, dan ${extraCount} lainnya` : "";

  console.log(
    `Skip plugin API: ${skippedApiPlugins.length} plugin dilewati karena API key nonaktif (${preview}${extraText})`
  );
}

async function reloadPlugins() {
  const loadState = {
    skippedApiPlugins: [],
  };

  plugins = await loadPlugins(pluginsPath, loadState);
  logSkippedApiPlugins(loadState.skippedApiPlugins);

  if (plugins.length === 0) {
    console.warn("WARNING: Tidak ada plugin yang dimuat.");
  }

  return plugins;
}

export { reloadPlugins };
