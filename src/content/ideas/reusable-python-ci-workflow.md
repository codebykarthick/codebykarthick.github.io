---
title: Reusable CI workflow for my Python repos
summary: One shared GitHub Actions workflow for lint, test and image build that every Python repo calls, instead of copy-pasted YAML.
status: exploring
technologies: [github-actions, python, docker]
---

Look into `workflow_call` reusable workflows versus composite actions, how inputs and secrets pass through, and how to version the shared workflow so a change can't break every repo at once.
