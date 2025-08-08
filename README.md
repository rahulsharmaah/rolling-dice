# Spindle Dice – Next.js 15 + Tailwind (OKLCH) + Three.js

A 4-sided spindle/pen-like dice you can roll by button or flick gesture. After 4 rolls, it shows a sequence-based thought.

## Stack
- Next.js 15.4.1 (App Router)
- React 18
- Tailwind CSS (colors defined in **OKLCH**)
- Three.js 0.160

## Install (pnpm)
```bash
pnpm i
pnpm dev
```

## Build
```bash
pnpm build && pnpm start
```

## Files
- `components/SpindleDice.tsx` — the Three.js scene + UI
- `lib/thoughts.ts` — sequence → thought mapping + fallback
- Tailwind colors use OKLCH strings in `tailwind.config.ts`
