/**
 * Browser entry for the agent panel.
 *
 * The deli has to work as a deli with no agent at all — that is a requirement
 * (SPEC §6.4) and a tested property. So index.html carries NO agent markup: a
 * reader with scripts off, or with this module failing to load, gets the whole
 * menu, every ingredient list and a working cart, and nothing is missing from the
 * page but this panel. The panel is created here, at runtime, and appended after
 * the main layout.
 *
 * The verdict cards are the one thing that matters most and they are also the
 * cheapest: boot() wires them before it touches the network, a router or a key.
 */

import { boot } from "../runtime/boot.ts";

if (typeof document !== "undefined" && document.querySelector("[data-menu]")) {
  const host = document.createElement("div");
  host.className = "agent-host";
  const main = document.querySelector("main.layout");
  if (main) main.insertAdjacentElement("afterend", host);
  else document.body.append(host);
  void boot(host);
}
