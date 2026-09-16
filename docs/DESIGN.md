---
name: ClientDeck
description: A compact Windows utility for keeping client profiles legible and easy to switch.
colors:
  accent: "#236553"
  accent-hover: "#174c3e"
  accent-soft: "#e2eee7"
  bg: "#f7f7f2"
  surface: "#fff"
  sidebar: "#eeefe8"
  ink: "#242c29"
  muted: "#626b64"
  line: "#dfe3da"
  hover: "#f0f3ed"
  field: "#fff"
  danger: "#a4313e"
  primary-text: "#fff"
  dark-bg: "#1c2320"
  dark-surface: "#242d28"
  dark-sidebar: "#18201b"
  dark-ink: "#e8ede5"
  dark-muted: "#b1bdb2"
  dark-line: "#3b473d"
  dark-accent: "#94d4b6"
  dark-accent-hover: "#b1e2ca"
  dark-accent-soft: "#314b3e"
  dark-hover: "#303b33"
  dark-field: "#232d26"
  dark-danger: "#f2a1aa"
  dark-primary-text: "#172a20"
  teal-bg: "#dbeae4"
  teal-ink: "#245a49"
  amber-bg: "#f4e6c8"
  amber-ink: "#755616"
  violet-bg: "#e7e0f2"
  violet-ink: "#61458a"
  blue-bg: "#dde9f5"
  blue-ink: "#365f88"
  rose-bg: "#f3dfe4"
  rose-ink: "#944760"
  slate-bg: "#e3e7e5"
  slate-ink: "#4d6056"
  status-idle: "#76827a"
  status-running: "#358564"
  status-starting: "#ae7b26"
  status-error: "#ba4a54"
  warning-bg: "#f5ecd8"
  warning-ink: "#72551e"
  error-bg: "#f9e9e9"
  error-ink: "#952c36"
  dark-warning-bg: "#483d25"
  dark-warning-ink: "#edd6a7"
  dark-error-bg: "#492b30"
  dark-error-ink: "#f6b9c0"
  selection-bg: "#b9d9cc"
  selection-ink: "#172e25"
  scrollbar-thumb: "#adb8af"
typography:
  headline:
    fontFamily: "'Segoe UI', system-ui, sans-serif"
    fontSize: "29px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-.025em"
  headline-compact:
    fontFamily: "'Segoe UI', system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-.025em"
  title:
    fontFamily: "'Segoe UI', system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "'Segoe UI', system-ui, sans-serif"
    fontSize: "13px"
    lineHeight: 1.65
  label:
    fontFamily: "'Segoe UI', system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
  button:
    fontFamily: "'Segoe UI', system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
  client-name:
    fontFamily: "'Segoe UI', system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
  account-label:
    fontFamily: "'Segoe UI', system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 400
  status:
    fontFamily: "'Segoe UI', system-ui, sans-serif"
    fontSize: "10px"
  brand:
    fontFamily: "'Segoe UI', system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 650
    letterSpacing: "-.03em"
rounded:
  badge: "4px"
  preview: "5px"
  field: "6px"
  control: "7px"
  inset: "8px"
  menu: "9px"
  panel: "10px"
  circle: "50%"
spacing:
  compact: "4px"
  tight: "6px"
  control-gap: "8px"
  inline: "10px"
  field: "12px"
  group: "16px"
  toolbar: "18px"
  inset: "20px"
  panel-gap: "24px"
  section: "30px"
  page-inline: "34px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.primary-text}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "11px 15px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-primary-dark:
    backgroundColor: "{colors.dark-accent}"
    textColor: "{colors.dark-primary-text}"
  button-primary-dark-hover:
    backgroundColor: "{colors.dark-accent-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "9px 12px"
  button-launch:
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 9px"
  button-focus:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.control}"
    padding: "8px 9px"
  button-text:
    textColor: "{colors.accent}"
    rounded: "{rounded.control}"
    padding: "5px 0"
  input:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "10px 12px"
  navigation-active:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.accent}"
    rounded: "{rounded.control}"
    padding: "11px 12px"
    width: "100%"
  preview-label:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.preview}"
    padding: "6px 10px"
  profiles-panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
  profile-row:
    backgroundColor: "{colors.surface}"
    padding: "22px 18px"
  profile-row-selected:
    backgroundColor: "{colors.accent-soft}"
  avatar:
    rounded: "{rounded.panel}"
    width: "43px"
    height: "43px"
---

# Design System: ClientDeck

## Overview

**Creative North Star: "The Compact Client Desk"**

ClientDeck is a calm Windows working surface. Its identity comes from purposeful Segoe UI typography, warm neutral surfaces, restrained teal actions, and compact client rows. Clear client names, initials, and written status keep the utility readable during everyday switching.

A compact utility direction governs the system. Group separation gives controls room without turning each record into a large card. Light and dark themes share the same geometry and hierarchy; color changes the material, not the meaning. This document describes the shipped interface in `src/ui/style.css` and `src/ui/components/`.

**Key Characteristics:**

- Native Windows typography with compact, readable hierarchy.
- Warm light surfaces and green-tinted dark surfaces.
- Teal actions, thin dividers, and small outlined icons.
- Client identity and status expressed with text as well as color.
- Visible keyboard focus and reduced-motion support.

## Colors

The palette pairs warm paper and dark green ink with a quiet teal accent. Frontmatter preserves the exact CSS values; unprefixed surface tokens describe light mode and `dark-` tokens describe its theme overrides.

### Primary

- **Deep Teal** (`accent`): primary actions, selected navigation text, running status text, caret, and keyboard focus.
- **Soft Teal** (`accent-soft`): selected rows, Focus actions, count badges, success notices, and preview labels.
- **Pale Mint** (`dark-accent`): the same roles in dark mode; primary buttons use dark ink text to remain readable.

### Secondary

- **Profile identity colors** (`teal`, `amber`, `violet`, `blue`, `rose`, `slate` background/ink pairs): initials and profile color choices. These pairs stay unchanged in dark mode.
- **Semantic status colors** (`status-*`, `warning-*`, `error-*`, `danger`): distinguish process state, caution, feedback, and destructive text. Warning and error banners have explicit dark theme pairs.

### Neutral

- **Warm Paper** (`bg`), **White Surface** (`surface`), and **Sage Sidebar** (`sidebar`): three flat layers in light mode.
- **Green Ink Surfaces** (`dark-bg`, `dark-surface`, `dark-sidebar`, `dark-field`): the corresponding dark materials.
- **Ink**, **Muted**, and **Line**: text hierarchy and thin structural separators. Hover has a dedicated tonal surface in each theme.
- **Selection** and **Scrollbar Thumb**: extracted browser-control accents, retained as implemented across themes.

**The Written Status Rule.** Color supports a written state or identifiable client name; it never carries the meaning alone.

## Typography

**Body and UI Font:** Segoe UI, followed by system-ui and sans-serif. This is an intentional Windows utility choice. Controls inherit the UI family, and the search shortcut uses it as well. Diagnostics retain the browser's monospace `pre` presentation.

### Hierarchy

- **Headline:** restrained page titles; the compact variant takes over at the medium breakpoint.
- **Title:** section headings and the inline editor heading.
- **Body:** supporting instructions and descriptions with relaxed paragraph leading.
- **Label and button:** semibold controls and field names.
- **Client name:** semibold identity text; long names can wrap anywhere.
- **Account label:** smaller muted text, ellipsized on a single line.
- **Status:** compact written process state and ancillary information.
- **Brand:** a modest semibold wordmark with tightened tracking.

There is no decorative display face or invented type-scale ratio. Headline, title, body, and compact labels are sized for their actual roles.

**The Native Type Rule.** Use the shipped Segoe UI stack for application copy and controls; preserve the text hierarchy across both themes.

## Layout

The desktop shell uses a fixed left sidebar (206px) and a main workspace offset by the same amount. The top bar is 62px tall. Page content is centered with a 1320px maximum width and padding of 38px 34px 30px. The list and editor sit side by side with a 24px gap; the editor is 270px wide.

Rows and their header share `minmax(160px,1fr) 115px 105px` columns with 12px gaps. Client identity receives the flexible track, written status the middle track, and launch/focus plus overflow the final track. Rows use 22px 18px padding around a 43px initials tile. A single bordered panel contains the toolbar, column labels, rows, and privacy footer.

At a maximum width of 1080px the sidebar becomes 180px, page padding becomes 30px 25px, and the editor moves below the list with a 440px maximum width and a top divider. The secondary footer sentence disappears. At a maximum width of 800px navigation becomes a 70px icon rail; its buttons retain accessible labels and titles. Page padding becomes 28px 22px, row columns become `minmax(140px,1fr) 104px 98px`, row gaps become 6px, and row padding becomes 18px 14px. The shortcut hint is hidden while the shortcut remains available.

Settings and compatibility content use a 780px reading width. Empty-state supporting copy is limited to 36ch. This is the shipped desktop-responsive system; it does not establish a separate mobile composition.

## Elevation & Depth

Surfaces are flat and separated by background tone and thin borders. The only resting shadow belongs to the floating actions menu: `0 8px 30px #152d2426`. It communicates a temporary layer above the client list; rows and panels do not acquire card shadows.

The menu backdrop and menu use stacking levels 3 and 4. Keyboard focus uses an accent outline (2px) with a 3px offset. A selected color swatch uses a current-color outline (2px) with a 2px offset.

**The Temporary Layer Rule.** Reserve the existing shadow for the floating actions menu; use tone and separators for persistent surfaces.

## Shapes

Corners are softly rounded and functional. Small badges, fields, controls, inset panels, menus, and primary panels follow the extracted radius roles in the frontmatter. Profile initials share the panel corner shape. Color swatches and status dots are circular. Structural strokes are generally 1px; outlined SVG icons use a stroke width of 1.7.

## Components

### Buttons

Compact semibold buttons align icons and labels with an 8px gap. Primary actions use teal; secondary actions use the surface color and a thin line border. Launch is a small bordered action; Focus uses a soft accent fill. Text actions use accent ink. Icon buttons are 31px square and have accessible names.

Buttons transition background over .14s with ease-out. General hover uses the hover surface; primary hover uses its explicit light or dark variant. Disabled controls have half opacity and a default cursor. Focus-visible treatment is shared with links, fields, selects, and summaries. There is no custom pressed transform.

### Inputs / Fields

Fields use the field surface, ink text, a thin line border, and the field corner shape. Placeholder text is muted and the caret uses accent. Search is a borderless field inside the list toolbar, with a search icon and a keyboard hint at wider sizes. Editor fields have visible labels; help copy explains optional account labels. Checkboxes are 17px and use the accent color.

### Navigation

The sidebar uses full-width left-aligned buttons, muted default text, and a surface-filled accent active state. Workspace navigation sits above settings and compatibility. At compact width labels are visually hidden, while accessible names and tooltips remain. Active navigation retains its tonal distinction.

### Profile Panel and Rows

A thin bordered, rounded container holds compact aligned rows. Initials use one of six readable color pairs beside the full client name and a secondary account label. Selection fills the row with soft accent. Status combines a dot and words; launch/focus remains adjacent. The floating overflow menu groups profile actions without expanding the row.

The search shortcut, Ctrl+K, returns to client profiles, closes the editor and row menu, and focuses search. Enter in search launches or focuses the first eligible visible profile. Escape closes transient editor, menu, and import preview state. These are observed interaction rules, not evidence of downstream account or task compatibility.

### Tags and Feedback

The preview label is a small soft-accent tag. Count badges are compact and sit within navigation. Success uses the soft accent pair; warnings and errors use their semantic pairs. Notification and error containers have status and alert roles respectively, with labeled dismiss buttons.

### Profile Editor

The editor stays in the workspace flow, has a larger initials preview (52px), visible field labels, labeled color choices with `aria-pressed`, and a full-width save action. Opening it focuses the client-name field. Its entry animation moves 5px horizontally and fades from .8 opacity over .18s with ease-out. Refresh uses a 1s linear rotation while pending. Reduced-motion preference removes all animations and transitions.

## Do's and Don'ts

### Do:

- **Do** preserve the native Segoe UI hierarchy and compact control density.
- **Do** keep names, initials, and written status legible in both themes.
- **Do** use the shared accent focus outline for keyboard-operable controls.
- **Do** preserve accessible names when navigation labels collapse.
- **Do** honor reduced-motion preference for transitions and animations.

### Don't:

- **Don't** use color alone to identify a client or process state.
- **Don't** add resting shadows to list rows or permanent panels.
- **Don't** replace the compact utility surface with a marketing hero or metric tiles.
- **Don't** infer account identity, task completion, or Cowork compatibility from visual process status.
