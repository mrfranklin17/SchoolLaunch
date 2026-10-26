---
name: apple-design
description: Apple.com-style web design guidance — generous whitespace, typography-first hierarchy, restrained palette, precise detail. Use when asked for an "Apple-style" or Apple-inspired page, landing page, marketing site, pricing page, or feature showcase, or to restyle a page in that aesthetic. Not for SchoolLaunch dashboard UI unless explicitly asked.
---

# Apple Design

Generate web UI that follows the design language of apple.com. Adapted from
[chaos-xxl/apple-design-skill](https://github.com/chaos-xxl/apple-design-skill)
(MIT, see `LICENSE`); the reference files are copied unchanged from that repo.

## Core principles

1. **Simplicity over decoration** — remove every element without a clear purpose.
2. **Whitespace is a feature** — 80–120px between sections.
3. **Typography-first hierarchy** — large bold headlines (48–80px), stepping down in size and weight.
4. **Restrained palette** — #FFFFFF, #F5F5F7, #1D1D1F backgrounds; accent blue #0066CC sparingly for interactive elements.
5. **Precision in detail** — 12–20px radii, layered soft shadows, smooth transitions.
6. **Content-centered layout** — content 980–1200px wide, centered; imagery may go full-bleed.

## Workflow

If the request is vague, ask once (in one message): what the page is for, its 3–5 key
sections, and the tone. If it's already specific, go straight to code.

Read only the references the task needs, in this order for a full page:

| Need | Reference |
|------|-----------|
| Colors, spacing, radii, shadows, gradients, breakpoints | `references/design-tokens.md` |
| Font stacks, sizes, weights, line-height, letter-spacing | `references/typography.md` |
| Headlines, subheads, body copy | `references/copywriting.md` |
| Hero/product imagery, placeholders, gradient fallbacks, alt text | `references/image-curation.md` |
| Section templates (hero, product grid, feature cards, scroll) | `references/layout-patterns.md` |

`references/main.md` is the upstream overview. Finished examples (prompt + output HTML)
live in `examples/product-landing`, `examples/feature-showcase` and `examples/pricing-page`.

## Output rules

- Use CSS custom properties for token values so they're easy to override.
- Semantic class names (`.hero`, `.feature-card`) over utility-only markup; Tailwind is fine when the project uses it.
- Valid, accessible HTML: proper heading order, descriptive `alt` text, ARIA where needed.
- Don't fetch images or call external APIs; use the keyword suggestions and CSS gradient fallbacks.
- Ignore the upstream notes about OpenClaw/ClawHub and copying `CLAUDE.md` to the project root — they don't apply here.

## In SchoolLaunch

When working inside the SchoolLaunch app, the project's own rules win: keep the `globals.css`
`@theme` colors and WCAG AA contrast (check with `@axe-core/playwright`), chart hues from
`chartUtils.ts` / `healthThresholds.ts`, and no `opacity-*` text fading. Borrow this skill's
spacing, hierarchy and restraint rather than its literal palette or fonts.
