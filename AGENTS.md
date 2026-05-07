# AGENTS.md

## Project

Dragon Fly 65 is a hypothetical W65C832-inspired computer, operating system, and SSH-accessible environment written in TypeScript for Bun.

The project is intended to become an open-source system that can run on Fly.io.

## Commands

- Install dependencies: `bun install`
- Run locally: `bun run dev`
- Run tests: `bun test`
- Typecheck: `bun run typecheck`

## Guidelines

- Prefer small, focused changes that match the existing project structure.
- Keep TypeScript strict and explicit around CPU, memory, operating system, and network state.
- Add tests for emulator, operating system, SSH, and protocol behavior as those areas are introduced.
- Document invented architecture decisions in `docs/`.
- Do not treat real W65C832 behavior as guessed fact. Verify it, cite it in docs, or clearly mark the behavior as Dragon Fly 65-specific design.
- Keep runtime assumptions compatible with Bun and container deployment.

## Open Source

- Keep public-facing files clear and welcoming.
- Preserve the MIT license unless the project maintainer explicitly changes it.
- Use issues or design documents for large architecture decisions before implementation.
