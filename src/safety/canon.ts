import type { Menu, Restriction } from "../../contracts";
import rawMenu from "../../data/menu.json" with { type: "json" };
import rawRestrictions from "../../data/restrictions.json" with { type: "json" };
import { loadMenu } from "./menu.ts";
import { loadRestrictions } from "./restrictions.ts";

/** The one canonical menu and restriction set. Tasks 4, 6 and 8 import these. */
export const MENU: Menu = loadMenu(rawMenu);
export const RESTRICTIONS: Restriction[] = loadRestrictions(rawRestrictions, MENU);
