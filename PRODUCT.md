# Product

<!-- impeccable:product-schema 1 -->

## Platform
web

Electron-rendered Windows desktop utility, not a website.

## Stack
User approved Electron, TypeScript, React, Node.js, Electron Forge, and local storage in clientdeck-app-plan.md.

## Users
A consultant managing Claude Desktop for multiple clients. Start with two client accounts; a third can be added later.

## Product Purpose
Keep client accounts in separate persistent Desktop profiles and make switching easy without repeated sign-out.

## Operating Context
Windows 11 x64, installed Claude Desktop MSIX. Users authenticate in Claude itself. The user has signed into two test profiles.

## Capabilities and Constraints
Named profiles, launch/focus, clear client identity, tray controls, metadata import/export, profile editing, startup preferences, diagnostics. No credentials in the launcher. Account separation is not filesystem isolation. Cowork and Code execution remain unverified. No API usage meter or task-status claims from process existence.

## Brand Commitments
Working name ClientDeck. User approved a compact client list with clear name/color/status and Launch or Focus, with Add Profile for future clients. Reference is loosely Claude Desktop Manager, not a clone.

## Evidence on Hand
Three independent Desktop processes and data directories observed; user reports two client sign-ins completed. docs/COMPATIBILITY.md records limitations.

## Product Principles
Make the active client legible. Preserve authenticated data by default. Show only measured status. Keep implementation details in advanced settings. Provide a complete local application with original open-source code.

## Accessibility & Inclusion
Keyboard access, visible focus, text alongside status colors, light/dark/system themes, no color-only identification.
