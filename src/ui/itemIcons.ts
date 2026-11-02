import type { ItemId } from '../race/Items';

/** Little pictures of the items for the HUD's item slot (inline SVG, 48x48). */
export const ITEM_ICONS: Record<ItemId, string> = {
  // A ramune bottle with its marble.
  ramune: bottle(24),
  ramune3: `${bottle(12, 0.8)}${bottle(24, 0.8)}${bottle(36, 0.8)}`,
  // A glossy black puddle with a rainbow sheen.
  oil: `<ellipse cx="24" cy="30" rx="18" ry="9" fill="#0b0912"/><ellipse cx="20" cy="28" rx="9" ry="3.5" fill="none" stroke="#c46bff" stroke-width="1.6" opacity="0.8"/><ellipse cx="27" cy="31" rx="7" ry="2.6" fill="none" stroke="#5ee0ff" stroke-width="1.4" opacity="0.7"/><path d="M24 6c5 7 7 10 7 13a7 7 0 0 1-14 0c0-3 2-6 7-13z" fill="#16131f" stroke="#3b3550" stroke-width="1.2"/>`,
  // A four-pointed throwing star.
  shuriken: `<g transform="translate(24 24) rotate(15)"><path d="M0-20 5-5 20 0 5 5 0 20-5 5-20 0-5-5Z" fill="#b8c2d3" stroke="#56607a" stroke-width="1.5" stroke-linejoin="round"/><circle r="3.2" fill="#2a2f3d"/></g>`,
  // A red paper lantern, glowing.
  lantern: `<circle cx="24" cy="25" r="17" fill="#ff7a3d" opacity="0.25"/><rect x="17" y="6" width="14" height="4" rx="1.5" fill="#2a1b17"/><rect x="17" y="38" width="14" height="4" rx="1.5" fill="#2a1b17"/><ellipse cx="24" cy="24" rx="12" ry="14.5" fill="#e8331f"/><path d="M13 19h22M12 24h24M13 29h22" stroke="#9c1c10" stroke-width="1.2"/><text x="24" y="28" font-size="11" text-anchor="middle" fill="#ffe7a8" font-weight="700">灯</text>`,
  // A lucky cat's face, raising a paw.
  luckycat: `<circle cx="24" cy="24" r="21" fill="#ffd34d" opacity="0.25"/><path d="M11 18 13 6l8 7M37 18 35 6l-8 7" fill="#fff" stroke="#c9a23a" stroke-width="1.5" stroke-linejoin="round"/><circle cx="24" cy="25" r="14" fill="#fff" stroke="#c9a23a" stroke-width="1.5"/><path d="M18 23q2-2 4 0M26 23q2-2 4 0" stroke="#2b2b2b" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="M22 29q2 2 4 0" stroke="#e34a4a" stroke-width="1.4" fill="none" stroke-linecap="round"/><circle cx="24" cy="36" r="3" fill="#ffcc2e" stroke="#c9a23a"/><rect x="36" y="20" width="7" height="12" rx="3.5" fill="#fff" stroke="#c9a23a" stroke-width="1.5"/>`,
  // A taiko drum with a lightning bolt.
  thunder: `<ellipse cx="24" cy="15" rx="15" ry="5" fill="#f2e1c2" stroke="#6b3a1e" stroke-width="1.5"/><path d="M9 15v17c0 3 7 6 15 6s15-3 15-6V15" fill="#b5452a" stroke="#6b3a1e" stroke-width="1.5"/><path d="M27 4 19 20h6l-4 14 11-18h-7l4-12z" fill="#ffe14a" stroke="#c99a00" stroke-width="1.2" stroke-linejoin="round"/>`,
};

function bottle(cx: number, s = 1): string {
  return `<g transform="translate(${cx} 25) scale(${s})"><path d="M-3-19h6v7l5 6v20a4 4 0 0 1-4 4h-8a4 4 0 0 1-4-4V-6l5-6z" fill="#7fd6ff" fill-opacity="0.75" stroke="#2b8ac7" stroke-width="1.6" stroke-linejoin="round"/><circle cy="-9" r="2.6" fill="#e9fbff" stroke="#2b8ac7" stroke-width="1"/><rect x="-6" y="0" width="12" height="9" rx="1.5" fill="#fff" opacity="0.85"/><path d="M-4 4h8" stroke="#2b8ac7" stroke-width="1.4"/></g>`;
}

export function itemSvg(id: ItemId): string {
  return `<svg viewBox="0 0 48 48" aria-hidden="true">${ITEM_ICONS[id]}</svg>`;
}
