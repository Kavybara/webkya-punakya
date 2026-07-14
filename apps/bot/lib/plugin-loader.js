import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { logHandler, logWarning } from "./panel-log.js";

async function listPluginFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listPluginFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(fullPath);
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

function normalizeCommands(commands = []) {
  return commands.map((command) => String(command || "").trim().toLowerCase()).filter(Boolean);
}

export async function loadPlugins({ pluginsDir, logger }) {
  const files = await listPluginFiles(pluginsDir);
  const items = [];

  for (const file of files) {
    try {
      const mod = await import(pathToFileURL(file).href);
      const plugin = mod.default || mod.plugin;
      if (!plugin?.name || typeof plugin.execute !== "function") {
        logWarning(`Skipping invalid plugin ${path.basename(file)}`);
        continue;
      }

      items.push({
        category: "other",
        description: "",
        commands: [],
        groupOnly: false,
        ownerOnly: false,
        priority: 100,
        ...plugin,
        commands: normalizeCommands(plugin.commands || []),
        file,
      });
    } catch (error) {
      logWarning(`Failed to load plugin ${path.basename(file)}`, error);
    }
  }

  items.sort((a, b) => Number(a.priority || 100) - Number(b.priority || 100));
  logHandler("Load All Handler done...");

  return {
    items,
    async dispatch(context) {
      for (const plugin of items) {
        if (plugin.groupOnly && !context.isGroup) {
          continue;
        }
        if (plugin.ownerOnly && !context.isOwner) {
          continue;
        }

        const shouldHandle =
          typeof plugin.shouldHandle === "function"
            ? await plugin.shouldHandle(context)
            : plugin.commands.includes(context.command);

        if (!shouldHandle) {
          continue;
        }

        let result;
        try {
          result = await plugin.execute({ ...context, plugin });
        } catch (error) {
          logWarning(`Plugin ${plugin.name} gagal dieksekusi`, error);
          throw error;
        }
        if (result?.continue === true && result?.handled === false) {
          continue;
        }
        return result || { handled: true, plugin: plugin.name };
      }

      return { handled: false };
    },
  };
}
