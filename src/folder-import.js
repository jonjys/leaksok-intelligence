/* Read-only directory import. No background claim: scans only an unlocked,
   visible app. Permission prompts are confined to explicit user actions. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LeakFolderImport = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const eligible = (file) => /\.(xlsx|xls|csv)$/i.test(file.name) && !file.name.startsWith("~$") && file.size > 0;
  const fingerprint = (file) => `${file.size}:${file.lastModified}`;

  function create({ storage, pickDirectory, onFiles, onStatus = () => {}, isReady = () => true, intervalMs = 60000 }) {
    let profileId = null, source = null, timer = null, busy = false, generation = 0;
    let status = { phase: "disconnected", name: "", lastChecked: null, message: "" };
    function emit(phase, message = "") {
      status = { phase, name: source?.name || "", lastChecked: source?.lastChecked || null, message };
      onStatus(status);
    }
    function stopTimer() { if (timer) clearInterval(timer); timer = null; }
    function startTimer() { stopTimer(); timer = setInterval(() => { if (isReady()) scan(); }, intervalMs); }
    async function save() { await storage.saveImportSource(profileId, source); }

    async function scan() {
      if (busy || !source || !profileId || !isReady()) return;
      busy = true;
      const run = generation, current = source;
      const valid = () => run === generation && current === source;
      try {
        if (await current.handle.queryPermission({ mode: "read" }) !== "granted") {
          if (valid()) { stopTimer(); emit("permission", "Tillåt läsning för att fortsätta mappimporten."); }
          return;
        }
        const pending = [], unreadable = [];
        for await (const entry of current.handle.values()) {
          if (!valid() || !isReady()) return;
          if (entry.kind !== "file" || !/\.(xlsx|xls|csv)$/i.test(entry.name) || entry.name.startsWith("~$")) continue;
          try {
            const file = await entry.getFile();
            if (eligible(file) && current.seen[file.name] !== fingerprint(file)) pending.push(file);
          } catch { unreadable.push(entry.name); }
        }
        if (!valid() || !isReady()) return;
        if (pending.length) {
          emit("scanning", `Läser ${pending.length} nya eller ändrade filer…`);
          const result = await onFiles(pending.sort((a, b) => a.name.localeCompare(b.name)));
          if (!valid()) return;
          if (!result?.saved) { emit("error", "Importen kunde inte sparas. Filerna försöks igen vid nästa kontroll."); return; }
          const accepted = new Set(result.accepted || []);
          for (const file of pending) if (accepted.has(file.name)) current.seen[file.name] = fingerprint(file);
          current.lastChecked = new Date().toISOString();
          await save();
          if (valid()) emit(accepted.size < pending.length || unreadable.length ? "error" : "connected", unreadable.length ? `Kunde inte öppna ${unreadable.join(", ")}. Övriga filer har behandlats.` : accepted.size < pending.length ? "Några filer kunde inte läsas. Se importloggen." : `${accepted.size} filer behandlade. Historiken är uppdaterad.`);
        } else {
          current.lastChecked = new Date().toISOString();
          await save();
          if (valid()) emit(unreadable.length ? "error" : "connected", unreadable.length ? `Kunde inte öppna ${unreadable.join(", ")}. Filerna försöks igen vid nästa kontroll.` : "");
        }
      } catch (error) {
        if (valid()) {
          if (["NotAllowedError", "SecurityError"].includes(error.name)) { stopTimer(); emit("permission", "Tillåt läsning av exportmappen igen."); }
          else emit("error", `Kunde inte läsa exportmappen: ${error.message}`);
        }
      } finally { busy = false; if (valid()) onStatus(status); }
    }

    async function open(id) {
      stopTimer(); generation++; profileId = id; source = null;
      const run = generation;
      try {
        const stored = await storage.loadImportSource(id);
        if (run !== generation) return;
        source = stored;
        if (!source) { emit("disconnected"); return; }
        source.seen ||= {};
        const permission = await source.handle.queryPermission({ mode: "read" });
        if (run !== generation) return;
        if (permission === "granted") {
          emit("connected"); startTimer(); await scan();
        } else emit("permission", "Tillåt läsning för att återuppta mappimporten.");
      } catch (error) { if (run === generation) emit("error", error.message); }
    }
    async function connect() {
      if (!pickDirectory || !profileId || busy) return;
      // Start the picker inside the click's transient activation.
      try {
        const handle = await pickDirectory({ id: "leaksok-exports", mode: "read", startIn: "downloads" });
        stopTimer(); generation++;
        source = { handle, name: handle.name, seen: {}, lastChecked: null };
        try { await save(); } catch { emit("error", "Mappen kan läsas nu men anslutningen kunde inte sparas."); }
        startTimer(); await scan();
      } catch (error) { if (error.name !== "AbortError") emit("error", error.message); }
    }
    async function resume() {
      if (!source || busy) return;
      try {
        if (await source.handle.requestPermission({ mode: "read" }) !== "granted") { emit("permission", "Läsbehörighet behövs för mappimport."); return; }
        startTimer(); await scan();
      } catch (error) { emit("error", error.message); }
    }
    async function disconnect() {
      if (busy) return false;
      await storage.clearImportSource(profileId);
      stopTimer(); generation++; source = null; emit("disconnected"); return true;
    }
    function pause() { stopTimer(); generation++; emit(source ? "paused" : "disconnected"); }
    return { open, connect, scan, resume, disconnect, pause, getStatus: () => ({ ...status }), isBusy: () => busy };
  }
  return { create, eligible, fingerprint };
}));
