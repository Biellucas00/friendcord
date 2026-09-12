export async function startDesktopUpdater() {
  if (!("__TAURI_INTERNALS__" in window)) return;
  try {
    const [{ check }, { relaunch }] = await Promise.all([import("@tauri-apps/plugin-updater"), import("@tauri-apps/plugin-process")]);
    const update = await check();
    if (!update || !window.confirm(`FriendCord ${update.version} esta disponivel. Atualizar agora?`)) return;
    await update.downloadAndInstall();
    await relaunch();
  } catch (error) {
    console.warn("Nao foi possivel verificar atualizacoes do FriendCord.", error);
  }
}
