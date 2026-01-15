# SQL Workbench for Obsidian

Opinionated SQL analysis tools for developers who maintain real-world, long-lived SQL.

> ⚠ Status: Experimental  
> 🎯 Audience: Developers / Database Engineers  
> 🧪 Stability: APIs and behaviors may change without notice

For core design principles and non-negotiable decisions,
see [DESIGN.md](DESIGN.md).

---

## This plugin is NOT for everyone

This plugin intentionally targets users who:

- maintain large and complex SQL files
- care about long-term maintainability
- want to understand SQL structure before execution
- work with production databases

If you are looking for a beginner-friendly SQL editor or query runner,
this plugin is not for you.

---

## Why this plugin exists

In production systems, SQL is not small, clean, or temporary.

It is often:
- copied across years
- modified by many people
- tightly coupled to schema evolution
- hard to reason about safely

Most SQL editors focus on *writing* SQL.
This plugin focuses on **understanding existing SQL assets**.

The goal is not convenience.
The goal is **risk reduction and structural clarity**.

---

## What this plugin focuses on

- Static analysis over execution
- Structural understanding over formatting
- Inspection over automation
- Long-term maintenance over short-term productivity

This plugin treats SQL as **an asset**, not a disposable script.

---

## Features

- SQL viewing optimized for large files
- Structural inspection (experimental)
- Architecture designed for external analysis engines
- Foundation for dependency analysis and risk evaluation

Feature completeness is intentionally limited.
Capabilities will grow only if they support the core philosophy.

---

## Non-goals

This plugin intentionally does NOT provide:

- SQL execution or database connections
- Visual query builders
- Beginner tutorials
- Full dialect compatibility
- Magic abstractions

If a feature hides SQL behavior instead of revealing it,
it will not be added.

---

## Usage

1. Install the plugin
2. Open a `.sql` file
3. Use the command palette to inspect and analyze

The plugin does not modify your SQL.
It only helps you **see what is already there**.

---

## Design Philosophy

- **Static analysis first**
- **Separation of concerns**
  - Obsidian handles UI and navigation
  - External CLI tools handle heavy analysis
- **Inspectability over cleverness**
- **Designed to survive schema and team changes**

This architecture intentionally supports:
- CI/CD integration
- fork-based customization
- external automation

---

## Roadmap (subject to change)

- [ ] SQL dependency analysis (sql deps)
- [ ] SQL risk / danger scoring
- [ ] ER diagram integration
- [ ] External CLI-based analysis engine
- [ ] Machine-readable outputs (JSON / SVG / Excel)

Features will be added only if they strengthen
structural understanding and operational safety.

---

## Installation

This plugin is not yet published in the Obsidian Community Plugin list.

Manual installation:

1. Clone or download this repository
2. Place it under your Obsidian plugins directory
3. Enable the plugin in Obsidian settings

---

## License

Apache License 2.0

---

## Contributing

Issues and discussions are welcome.

Pull requests are welcome,
but architectural changes should be discussed in advance.

This project assumes contributors understand
that simplicity and explicitness are valued over convenience.

---

## Development

To deploy directly into your vault during development, copy `.env.example` to `.env` and set `OBSIDIAN_PLUGIN_DIR`.
